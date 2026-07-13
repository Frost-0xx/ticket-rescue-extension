/* global browser */

const API_BASE = "https://api.geturtix.com";
const TICKETNETWORK_PROMO = "Tix25";
const TICKETNETWORK_UTM = Object.freeze({
  utm_source: "ir",
  utm_medium: "aff",
  utm_content: "ad",
  utm_campaign: "1382158"
});

const VIEW_IDS = Object.freeze({
  loading: "loadingView",
  unsupported: "unsupportedView",
  event: "eventView",
  message: "messageView"
});

const $ = (id) => document.getElementById(id);

let lastCtx = null;
let lastPayload = null;
let activeTab = null;
let currentView = "loading";
let messageAction = null;
let settingsOpen = false;

let BUILD = { ENV: "prod", FLAGS: { DEBUG_UI: false, DEBUG_LOGS: false } };

function log(...args) {
  if (BUILD?.FLAGS?.DEBUG_LOGS) console.log("[Another Tab]", ...args);
}

function setStatus(text) {
  $("status").textContent = text || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtMoney(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return `$${number.toFixed(2)}`;
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isSupportedHost(host) {
  if (!host) return false;
  return ["ticketmaster.com", "stubhub.com", "vividseats.com", "seatgeek.com"].some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );
}

function isSupportedUrl(url) {
  return isSupportedHost(hostFromUrl(url));
}

function isEventContext(ctx) {
  const performer = String(ctx?.performer_query || ctx?.raw_title || "").trim();
  const city = String(ctx?.city || "").trim();
  return Boolean(performer && city);
}

function safeTrackedUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!/^https?:$/.test(url.protocol)) return "#";

    const host = url.hostname.toLowerCase();
    if (host === "ticketnetwork.com" || host.endsWith(".ticketnetwork.com")) {
      for (const [key, val] of Object.entries(TICKETNETWORK_UTM)) {
        if (!url.searchParams.has(key)) url.searchParams.set(key, val);
      }
    }

    return url.toString();
  } catch {
    return "#";
  }
}

function setView(name) {
  currentView = VIEW_IDS[name] ? name : "message";
  for (const [viewName, id] of Object.entries(VIEW_IDS)) {
    $(id).hidden = viewName !== currentView;
  }
}

function setSettingsOpen(open) {
  settingsOpen = Boolean(open);
  $("mainContent").hidden = settingsOpen;
  $("settingsView").hidden = !settingsOpen;
  $("settingsBtn").setAttribute("aria-expanded", String(settingsOpen));
}

function showUnsupported() {
  messageAction = null;
  setView("unsupported");
  setStatus("Open an event on a supported ticket site.");
}

function showMessage({ eyebrow = "ANOTHER TAB", title, body, actionLabel, action }) {
  $("messageEyebrow").textContent = eyebrow;
  $("messageTitle").textContent = title || "Something went wrong.";
  $("messageBody").textContent = body || "Please try again.";

  const button = $("messageActionBtn");
  messageAction = typeof action === "function" ? action : null;
  button.hidden = !messageAction;
  button.textContent = actionLabel || "Try again";

  setView("message");
  setStatus(title || "Something went wrong.");
}

function showLoading() {
  setView("loading");
  setStatus("Looking for ticket offers.");
}

async function getBuildInfo() {
  try {
    const url = browser.runtime.getURL("config/build.json");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Build config ${response.status}`);
    return await response.json();
  } catch {
    return { ENV: "prod", FLAGS: { DEBUG_UI: false, DEBUG_LOGS: false } };
  }
}

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function extractCtx(response) {
  if (response?.context && typeof response.context === "object") return response.context;
  return null;
}

async function getPageContext(tabId) {
  try {
    const response = await browser.tabs.sendMessage(tabId, { type: "GET_PAGE_CONTEXT" });
    return extractCtx(response);
  } catch (error) {
    log("Could not read page context", error);
    return null;
  }
}

async function getDisabledHosts() {
  const result = await browser.storage.local.get({ disabledHosts: {} });
  return result.disabledHosts || {};
}

async function setHostDisabled(host, disabled) {
  const disabledHosts = await getDisabledHosts();
  if (disabled) disabledHosts[host] = true;
  else delete disabledHosts[host];
  await browser.storage.local.set({ disabledHosts });
}

const THEME_KEY = "theme";

function applyTheme(theme) {
  const selected = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", selected);
  $("themeLightBtn").classList.toggle("active", selected === "light");
  $("themeDarkBtn").classList.toggle("active", selected === "dark");
}

async function loadTheme() {
  const result = await browser.storage.local.get({ [THEME_KEY]: "dark" });
  return result[THEME_KEY] || "dark";
}

async function saveTheme(theme) {
  await browser.storage.local.set({ [THEME_KEY]: theme });
}

function sourceLabel(source) {
  const key = String(source || "").toLowerCase().trim();
  const labels = {
    tn: "TicketNetwork",
    tl: "TicketLiquidator",
    sbs: "SuperBoleteria",
    geturtix: "Get ur Tix"
  };
  return labels[key] || String(source || "Tickets");
}

function offerPrice(offer) {
  return offer?.est_after_promo ?? offer?.base_price_min ?? null;
}

function hasPromo(offer) {
  return offer?.promo_percent != null || Boolean(offer?.promo_code);
}

function sortOffers(offers) {
  const priceNumber = (offer) => {
    const value = Number(offerPrice(offer));
    return Number.isFinite(value) ? value : Infinity;
  };

  return (offers || []).slice().sort((a, b) => {
    const priceDifference = priceNumber(a) - priceNumber(b);
    if (priceDifference !== 0) return priceDifference;
    return sourceLabel(a?.source).localeCompare(sourceLabel(b?.source));
  });
}

function formatShortDate(dateDay) {
  if (!dateDay) return "";
  try {
    const date = new Date(`${String(dateDay).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC"
    })
      .format(date)
      .toUpperCase();
  } catch {
    return "";
  }
}

function fillEventIntro(match, ctx, sellerCount) {
  const city = String(match?.city || ctx?.city || "").trim();
  const date = formatShortDate(match?.date_day || ctx?.date_day);
  const kickerParts = [city ? city.toUpperCase() : "", date].filter(Boolean);
  const title =
    String(match?.event_name || ctx?.raw_title || ctx?.performer_query || "Event tickets").trim();

  $("eventKicker").textContent = kickerParts.join(" · ") || "EVENT FOUND";
  $("eventTitle").textContent = title;

  if (sellerCount === 1) {
    $("eventSummary").textContent = "One seller still has tickets.";
  } else if (sellerCount > 1) {
    $("eventSummary").textContent = `Best available prices across ${sellerCount} sellers.`;
  } else {
    $("eventSummary").textContent = "No matching ticket offers are available yet.";
  }
}

function offerBadgeText(offer, index) {
  const parts = [];
  if (index === 0) parts.push("Best price");
  if (offer?.promo_percent != null) parts.push(`${offer.promo_percent}% off`);
  return parts.join(" · ");
}

function offerMarkup(offer, index) {
  const label = sourceLabel(offer?.source);
  const promoCode = String(offer?.promo_code || "").trim();
  const badgeText = offerBadgeText(offer, index);
  const formattedPrice = fmtMoney(offerPrice(offer));
  const href = safeTrackedUrl(offer?.url);
  const priceMeta = hasPromo(offer) ? "after promo" : "base price";
  const actionText = formattedPrice ? `Get tickets for ${formattedPrice}` : "Check ticket prices";

  const badge = badgeText
    ? `<span class="offerBadge">${escapeHtml(badgeText)}</span>`
    : "";

  const promoRow = promoCode
    ? `
      <div class="offerCode">
        <span class="codeLabel">PROMO CODE</span>
        <code>${escapeHtml(promoCode)}</code>
      </div>
    `
    : "";

  const copyButton = promoCode
    ? `
      <button class="wideButton copyButton" type="button" data-copy="${escapeHtml(promoCode)}">
        <span aria-hidden="true">⧉</span>
        <span class="copyLabel">Copy ${escapeHtml(promoCode)}</span>
      </button>
    `
    : "";

  return `
    <article class="offer">
      <div class="offerTop">
        <div class="seller">
          <span class="sellerName">${escapeHtml(label)}</span>
          ${badge}
        </div>
        <div class="priceBlock">
          <span class="price">${escapeHtml(formattedPrice || "See price")}</span>
          <span class="priceMeta">${escapeHtml(priceMeta)}</span>
        </div>
      </div>
      ${promoRow}
      <div class="offerActions ${promoCode ? "" : "singleAction"}">
        ${copyButton}
        <a class="wideButton ${index === 0 ? "primaryButton" : ""}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(actionText)}</a>
      </div>
    </article>
  `;
}

function fallbackMarkup(fallback) {
  const links = fallback?.performer_links || null;
  if (!links) return "";

  const ordered = [
    ["tn", "TicketNetwork"],
    ["geturtix", "Get ur Tix"],
    ["tl", "TicketLiquidator"],
    ["sbs", "SuperBoleteria"]
  ];

  const items = ordered
    .filter(([key]) => links[key])
    .map(([key, label]) => {
      const href = safeTrackedUrl(links[key]);
      return `<a class="siteButton" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(label)}</span><span aria-hidden="true">↗</span></a>`;
    })
    .join("");

  return items ? `<div class="fallbackLinks">${items}</div>` : "";
}

function renderNoOffers(payload, match) {
  fillEventIntro(match, lastCtx, 0);
  $("results").innerHTML = `
    <div class="emptyOffers">
      <strong>No matching offers yet.</strong>
      <span>Try one of the seller pages for more options.</span>
      ${fallbackMarkup(payload?.fallback)}
    </div>
  `;
  $("eventFootnote").hidden = true;
  setView("event");
}

function renderResults(payload) {
  lastPayload = payload || null;

  const match = payload?.matches?.[0] || null;
  if (!match) {
    renderNoOffers(payload, null);
    return;
  }

  const offers = sortOffers((match.offers || []).filter((offer) => offer?.tickets_yn !== false));
  if (!offers.length) {
    renderNoOffers(payload, match);
    return;
  }

  fillEventIntro(match, lastCtx, offers.length);
  $("results").innerHTML = offers.map(offerMarkup).join("");
  $("eventFootnote").hidden = false;
  setView("event");
  setStatus(`${offers.length} ticket sellers found.`);
}

function buildMatchBodyFromCtx(ctx, tabUrl) {
  return {
    performer_query: ctx?.performer_query || null,
    raw_title: ctx?.raw_title || null,
    city: ctx?.city || null,
    state: ctx?.state || null,
    date_day: ctx?.date_day || null,
    time_24: ctx?.time_24 || null,
    page_url: tabUrl || null
  };
}

async function doMatch(ctx, tabUrl) {
  showLoading();
  const body = buildMatchBodyFromCtx(ctx, tabUrl);

  try {
    const response = await fetch(`${API_BASE}/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(`API ${response.status}`);
    }

    if (BUILD?.FLAGS?.DEBUG_UI) {
      $("devConfidence").textContent = payload?.confidence || "—";
      $("devHost").textContent = hostFromUrl(tabUrl) || "—";
      $("devJson").value = JSON.stringify({ tabUrl, ctx, payload }, null, 2);
    }

    renderResults(payload);
  } catch (error) {
    log("Match failed", error);
    showMessage({
      eyebrow: "CONNECTION PROBLEM",
      title: "We couldn’t compare prices.",
      body: "Check your connection and try again.",
      actionLabel: "Try again",
      action: refreshAll
    });
  }
}

async function updateSiteSetting(tabUrl) {
  const host = hostFromUrl(tabUrl);
  const supported = isSupportedHost(host);
  const toggle = $("enabledOnSite");

  toggle.disabled = !supported;

  if (!supported) {
    toggle.checked = false;
    $("siteSettingHelp").textContent = "Available on Ticketmaster, SeatGeek, Vivid Seats and StubHub";
    return;
  }

  const disabledHosts = await getDisabledHosts();
  toggle.checked = !disabledHosts[host];
  $("siteSettingHelp").textContent = `Compare offers on ${host}`;
}

async function refreshAll() {
  try {
    activeTab = await getActiveTab();
  } catch (error) {
    log("Active tab failed", error);
    activeTab = null;
  }

  const tabUrl = activeTab?.url || "";
  await updateSiteSetting(tabUrl);

  if (!activeTab?.id || !isSupportedUrl(tabUrl)) {
    lastCtx = null;
    lastPayload = null;
    showUnsupported();
    return;
  }

  const host = hostFromUrl(tabUrl);
  const disabledHosts = await getDisabledHosts();
  if (disabledHosts[host]) {
    showMessage({
      eyebrow: "COMPARISON PAUSED",
      title: "Another Tab is off on this site.",
      body: "Turn it back on in settings to compare ticket prices.",
      actionLabel: "Open settings",
      action: () => setSettingsOpen(true)
    });
    return;
  }

  const ctx = await getPageContext(activeTab.id);
  lastCtx = ctx;

  if (!isEventContext(ctx)) {
    lastPayload = null;
    showUnsupported();
    return;
  }

  await doMatch(ctx, tabUrl);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.top = "-1000px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      return copied;
    } catch {
      return false;
    }
  }
}

async function handleCopyButton(button) {
  const code = String(button.dataset.copy || "").trim();
  const label = button.querySelector(".copyLabel");
  if (!code || !label) return;

  const original = button.dataset.originalLabel || label.textContent;
  button.dataset.originalLabel = original;

  const copied = await copyToClipboard(code);
  label.textContent = copied ? `Copied: ${code}` : "Copy failed";
  setStatus(copied ? `Copied promo code ${code}.` : "Could not copy the promo code.");

  window.setTimeout(() => {
    if (label.isConnected) label.textContent = original;
  }, 1600);
}

function setupDevPanel() {
  const panel = $("debugPanel");
  const enabled = Boolean(BUILD?.FLAGS?.DEBUG_UI);
  panel.hidden = !enabled;
  if (!enabled) return;

  $("copyJsonBtn").addEventListener("click", async () => {
    const copied = await copyToClipboard($("devJson").value || "");
    setStatus(copied ? "Copied debug JSON." : "Copy failed.");
  });

  $("matchBtn").addEventListener("click", async () => {
    if (!lastCtx) return;
    setSettingsOpen(false);
    await doMatch(lastCtx, activeTab?.url || "");
  });
}

function setupInteractions() {
  document.addEventListener("click", (event) => {
    const copyButton = event.target.closest("[data-copy]");
    if (copyButton) handleCopyButton(copyButton);
  });

  $("settingsBtn").addEventListener("click", () => setSettingsOpen(!settingsOpen));
  $("closeSettingsBtn").addEventListener("click", () => setSettingsOpen(false));

  $("messageActionBtn").addEventListener("click", async () => {
    if (messageAction) await messageAction();
  });

  $("themeLightBtn").addEventListener("click", async () => {
    applyTheme("light");
    await saveTheme("light");
  });

  $("themeDarkBtn").addEventListener("click", async () => {
    applyTheme("dark");
    await saveTheme("dark");
  });

  $("refreshBtn").addEventListener("click", async () => {
    setSettingsOpen(false);
    await refreshAll();
  });

  $("enabledOnSite").addEventListener("change", async (event) => {
    const host = hostFromUrl(activeTab?.url || "");
    if (!isSupportedHost(host)) return;
    await setHostDisabled(host, !Boolean(event.target.checked));
    await refreshAll();
  });
}

async function init() {
  BUILD = await getBuildInfo();
  log("Build", BUILD);

  applyTheme(await loadTheme());
  setupInteractions();
  setupDevPanel();
  await refreshAll();
}

init();
