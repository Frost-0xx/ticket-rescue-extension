/* global browser */

const API_BASE = "https://api.geturtix.com";
const $ = (id) => document.getElementById(id);

let lastCtx = null;
let lastPayload = null;
let activeTab = null;

let BUILD = { ENV: "prod", FLAGS: { DEBUG_UI: false, DEBUG_LOGS: false } };

function log(...args) {
  if (BUILD?.FLAGS?.DEBUG_LOGS) console.log("[TR]", ...args);
}

function setStatus(s) {
  $("status").textContent = s || "";
}

function fmtMoney(x) {
  if (x == null) return "—";
  const n = Number(x);
  if (Number.isFinite(n)) return `$${n.toFixed(2)}`;
  const f = Number(String(x));
  if (Number.isFinite(f)) return `$${f.toFixed(2)}`;
  return `$${String(x)}`;
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function getBuildInfo() {
  try {
    const url = browser.runtime.getURL("config/build.json");
    const res = await fetch(url);
    return await res.json();
  } catch {
    return { ENV: "prod", FLAGS: { DEBUG_UI: false, DEBUG_LOGS: false } };
  }
}

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function hostFromUrl(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function extractCtx(resp) {
  if (!resp) return null;
  if (resp.context && typeof resp.context === "object") return resp.context;
  return null;
}

async function getPageContext(tabId) {
  try {
    const resp = await browser.tabs.sendMessage(tabId, { type: "GET_PAGE_CONTEXT" });
    return extractCtx(resp);
  } catch {
    return null;
  }
}

async function getDisabledHosts() {
  const r = await browser.storage.local.get({ disabledHosts: {} });
  return r.disabledHosts || {};
}

async function setHostDisabled(host, disabled) {
  const disabledHosts = await getDisabledHosts();
  if (disabled) disabledHosts[host] = true;
  else delete disabledHosts[host];
  await browser.storage.local.set({ disabledHosts });
}

/* Theme */
const THEME_KEY = "theme";

function applyTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", t);
  $("themeLightBtn").classList.toggle("active", t === "light");
  $("themeDarkBtn").classList.toggle("active", t === "dark");
}

async function loadTheme() {
  const r = await browser.storage.local.get({ [THEME_KEY]: "dark" });
  return r[THEME_KEY] || "dark";
}

async function saveTheme(theme) {
  await browser.storage.local.set({ [THEME_KEY]: theme });
}

/* UI fill */
function fillTopEventUI(ctx, tabUrl) {
  const title = ctx?.raw_title || "—";
  const city = ctx?.city || "—";
  const st = ctx?.state ? `, ${ctx.state}` : "";
  const dd = ctx?.date_day || "";
  const tm = ctx?.time_24 ? ` • ${ctx.time_24}` : "";

  $("eventTitle").textContent = title;
  $("eventMeta").textContent = dd ? `${dd}${tm} • ${city}${st}` : `${city}${st}`;
  $("hostline").textContent = tabUrl ? hostFromUrl(tabUrl) : "—";
}

/* Source mapping */
function sourceLabel(src) {
  const key = String(src || "").toLowerCase().trim();
  const map = {
    tn: "TicketNetwork",
    tl: "TicketLiquidator",
    sbs: "SuperBoleteria",
    geturtix: "Get ur Tix"
  };
  return map[key] || (src || "—");
}

function hasPromo(o) {
  return o?.promo_percent != null || o?.promo_code;
}

function offerPrice(o) {
  return o?.est_after_promo ?? o?.base_price_min ?? null;
}

function promoBadgeText(o) {
  if (o?.promo_percent == null) return null;
  return `${o.promo_percent}% promo`;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function setPill(text) {
  const pill = $("pill");
  if (!text) {
    pill.style.display = "none";
    pill.textContent = "";
    return;
  }
  pill.style.display = "inline-flex";
  pill.textContent = text;
}

function renderNoData(message) {
  $("results").innerHTML = `
    <div class="empty">
      <div class="emptyTitle">${escapeHtml(message || "No data")}</div>
    </div>
  `;
}

function renderNoMatch(payload) {
  const hint = payload?.hint ? ` • ${payload.hint}` : "";
  const reason = payload?.reason ? `${payload.reason}${hint}` : "No match";
  $("results").innerHTML = `
    <div class="empty">
      <div class="emptyTitle">No match</div>
      <div class="emptyMeta">${escapeHtml(reason)}</div>
      <div class="hint">We’ll log this and improve matching.</div>
    </div>
  `;
}

/* Sorting: geturtix first, rest by ascending price */
function sortOffers(offers) {
  const arr = (offers || []).slice();

  const priceNum = (o) => {
    const p = offerPrice(o);
    const n = Number(p);
    return Number.isFinite(n) ? n : Infinity;
  };

  return arr.sort((a, b) => {
    const as = String(a?.source || "").toLowerCase();
    const bs = String(b?.source || "").toLowerCase();

    const aIsG = as === "geturtix";
    const bIsG = bs === "geturtix";
    if (aIsG && !bIsG) return -1;
    if (!aIsG && bIsG) return 1;

    const ap = priceNum(a);
    const bp = priceNum(b);
    if (ap !== bp) return ap - bp;

    return sourceLabel(as).localeCompare(sourceLabel(bs));
  });
}

function renderResults(payload) {
  lastPayload = payload || null;

  if (!payload) {
    setPill(null);
    renderNoData("No data");
    return;
  }

  const matches = payload.matches || [];
  if (!matches.length) {
    setPill("No match");
    renderNoMatch(payload);
    return;
  }

  const m = matches[0];
  const offers = sortOffers(m.offers || []);
  if (!offers.length) {
    setPill("No offers");
    renderNoData("No offers found.");
    return;
  }

  if (payload.confidence != null) setPill(`Confidence: ${payload.confidence}`);
  else setPill(null);

  $("results").innerHTML = offers
    .map((o) => {
      const label = sourceLabel(o.source);
      const price = offerPrice(o);

      const srcKey = String(o?.source || "").toLowerCase();
      const compact = (srcKey === "tl" || srcKey === "sbs");

      const promoCode = o?.promo_code || null;
      const promoPct = o?.promo_percent != null ? `${o.promo_percent}%` : null;
      const badgeText = promoBadgeText(o);
      const badge = badgeText ? `<span class="badge">${escapeHtml(badgeText)}</span>` : "";

      const subline = hasPromo(o) ? "Est. after promo" : "";

      const codeBtn = promoCode
        ? `<button class="btn secondary copy" data-copy="${escapeHtml(promoCode)}" type="button">Copy code</button>`
        : "";

      return `
        <div class="offerRow">
          <div class="offerTop">
            <div class="leftTop">
              <a class="sourcelink ${compact ? "compact" : ""}" target="_blank" href="${escapeHtml(o.url)}">${escapeHtml(label)}</a>
              ${badge}
            </div>
            <div class="rightTop">
              <div class="price ${promoCode || promoPct ? "pricePromo" : ""}">
  ${escapeHtml(fmtMoney(price))}
</div>
            </div>
          </div>

          <div class="offerBottom">
            <div class="offerActionsRow">
              ${codeBtn}
              <a class="btn primary action" target="_blank" href="${escapeHtml(o.url)}">Get tickets</a>
            </div>
            ${subline ? `<div class="subline">${escapeHtml(subline)}</div>` : ``}
          </div>
        </div>
      `;
    })
    .join("");

  $("results").querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.getAttribute("data-copy") || "";
      const ok = await copyToClipboard(code);
      setStatus(ok ? `Copied: ${code}` : "Copy failed");
    });
  });
}

/* Matching */
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
  const body = buildMatchBodyFromCtx(ctx, tabUrl);

  setStatus("Matching...");
  $("results").innerHTML = "";

  try {
    const r = await fetch(`${API_BASE}/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const payload = await r.json().catch(() => null);

    if (!r.ok) {
      setPill("API error");
      setStatus(`API error: ${r.status}`);
      renderResults(payload);
      return;
    }

    const conf = payload?.confidence != null ? String(payload.confidence) : "";
    const reason = payload?.reason ? String(payload.reason) : "";
    setStatus(`OK${conf ? ` • ${conf}` : ""}${reason ? ` • ${reason}` : ""}`);

    if (BUILD?.FLAGS?.DEBUG_UI) {
      $("devConfidence").textContent = conf || "—";
      $("devHost").textContent = tabUrl ? hostFromUrl(tabUrl) : "—";
      $("devJson").value = JSON.stringify({ tabUrl, ctx, payload }, null, 2);
    }

    renderResults(payload);
  } catch (e) {
    setPill("Network error");
    setStatus(`Network error: ${String(e?.message || e)}`);
    renderNoData("Failed to fetch.");
  }
}

/* Dev panel */
function setupDevPanel() {
  const panel = $("debugPanel");
  if (!panel) return;

  const on = !!BUILD?.FLAGS?.DEBUG_UI;
  panel.style.display = on ? "block" : "none";
  if (!on) return;

  $("copyJsonBtn").addEventListener("click", async () => {
    const text = $("devJson").value || "";
    const ok = await copyToClipboard(text);
    setStatus(ok ? "Copied debug JSON." : "Copy failed");
  });

  $("matchBtn").addEventListener("click", async () => {
    const tabUrl = activeTab?.url || "";
    await doMatch(lastCtx, tabUrl);
  });
}

async function refreshAll() {
  activeTab = await getActiveTab();
  const tabUrl = activeTab?.url || "";

  $("hostline").textContent = tabUrl ? hostFromUrl(tabUrl) : "—";

  if (!activeTab?.id || !tabUrl || tabUrl.startsWith("chrome://") || tabUrl.startsWith("about:")) {
    setStatus("Open an event page first.");
    setPill(null);
    renderNoData("No active tab context.");
    return;
  }

  const host = hostFromUrl(tabUrl);
  const disabledHosts = await getDisabledHosts();
  const enabled = !disabledHosts[host];

  $("enabledOnSite").checked = enabled;

  if (!enabled) {
    setStatus("Disabled on this site.");
    setPill(null);
    $("eventTitle").textContent = "—";
    $("eventMeta").textContent = "—";
    renderNoData("Enable on this site to compare offers.");
    return;
  }

  const ctx = await getPageContext(activeTab.id);
  lastCtx = ctx;

  if (!ctx) {
    setStatus("Cannot read page data (content script blocked?).");
    setPill("No context");
    renderNoData("No page context.");
    return;
  }

  fillTopEventUI(ctx, tabUrl);
  await doMatch(ctx, tabUrl);
}

async function init() {
  BUILD = await getBuildInfo();
  log("BUILD:", BUILD);

  const theme = await loadTheme();
  applyTheme(theme);

  $("themeLightBtn").addEventListener("click", async () => {
    applyTheme("light");
    await saveTheme("light");
  });
  $("themeDarkBtn").addEventListener("click", async () => {
    applyTheme("dark");
    await saveTheme("dark");
  });

  $("refreshBtn").addEventListener("click", refreshAll);

  $("enabledOnSite").addEventListener("change", async (e) => {
    const tabUrl = activeTab?.url || "";
    const host = tabUrl ? hostFromUrl(tabUrl) : "";
    if (!host) return;

    const enabled = Boolean(e.target.checked);
    await setHostDisabled(host, !enabled);
    await refreshAll();
  });

  setupDevPanel();
  await refreshAll();
}

init();