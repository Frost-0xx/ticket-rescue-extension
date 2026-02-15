/* global browser, chrome */
try {
  // In Chrome MV3 service worker, importScripts is allowed if worker is not module.
  importScripts("../vendor/browser-polyfill.min.js");
} catch (e) {
  // Firefox may ignore importScripts in some contexts; safe to proceed if browser exists.
}

const DEFAULT_API_BASE = "https://api.geturtix.com";

async function getApiBase() {
  const api = await browser.storage.local.get({ apiBase: DEFAULT_API_BASE });
  return api.apiBase || DEFAULT_API_BASE;
}

browser.runtime.onInstalled.addListener(async () => {
  const { apiBase } = await browser.storage.local.get({ apiBase: DEFAULT_API_BASE });
  if (!apiBase) await browser.storage.local.set({ apiBase: DEFAULT_API_BASE });
});

browser.runtime.onMessage.addListener(async (msg) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "GET_API_BASE") {
    const apiBase = await getApiBase();
    return { apiBase };
  }

  if (msg.type === "SET_API_BASE") {
    const apiBase = String(msg.apiBase || "").trim();
    if (!apiBase) return { ok: false, error: "apiBase is empty" };
    await browser.storage.local.set({ apiBase });
    return { ok: true, apiBase };
  }
});