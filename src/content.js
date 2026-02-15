/* global browser */

console.log("[TR] content script loaded", location.href);

// Set true to force deterministic test context (for debugging only)
const DEBUG_FORCE_TEST = false;

function normSpace(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}
function safeLower(s) {
  return String(s || "").toLowerCase();
}
function hostname() {
  try {
    return (location.hostname || "").toLowerCase();
  } catch {
    return "";
  }
}
function getMeta(name) {
  const el =
    document.querySelector(`meta[property="${name}"]`) ||
    document.querySelector(`meta[name="${name}"]`);
  return el?.getAttribute("content")?.trim() || null;
}

const MONTH_MAP = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12"
};

function parseMonthDateYear(text) {
  const t = normSpace(text);
  if (!t) return null;

  const m =
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b\s+(\d{1,2}),\s+(\d{4})/i.exec(
      t
    );
  if (!m) return null;

  const monKey = m[1].slice(0, 3).toLowerCase();
  const mm = MONTH_MAP[monKey];
  if (!mm) return null;

  const dd = String(m[2]).padStart(2, "0");
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

function parseNumericDate(text) {
  const t = normSpace(text);
  if (!t) return null;

  const m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(t);
  if (!m) return null;

  const mm = String(m[1]).padStart(2, "0");
  const dd = String(m[2]).padStart(2, "0");
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

// Supports: "7:00 pm", "7 pm", "7pm", "07:00PM"
function parseTime12(text) {
  const t = normSpace(text);
  if (!t) return null;

  const m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(t);
  if (!m) return null;

  let hh = parseInt(m[1], 10);
  const mm = m[2] != null ? m[2] : "00";
  const ap = m[3].toLowerCase();

  if (ap === "pm" && hh !== 12) hh += 12;
  if (ap === "am" && hh === 12) hh = 0;

  return `${String(hh).padStart(2, "0")}:${mm}`;
}

// overwrite merge (for StubHub date etc.)
function mergeCtxOverwrite(a, b) {
  const out = { ...(a || {}) };
  for (const k of ["raw_title", "performer_query", "city", "state", "date_day", "time_24"]) {
    const v = b?.[k];
    if (v != null && String(v).trim() !== "") out[k] = v;
  }
  return out;
}

// fill-missing merge (prevents bad meta overwriting good)
function mergeCtxFillMissing(a, b) {
  const out = { ...(a || {}) };
  for (const k of ["raw_title", "performer_query", "city", "state", "date_day", "time_24"]) {
    const has = out?.[k] != null && String(out[k]).trim() !== "";
    const v = b?.[k];
    if (!has && v != null && String(v).trim() !== "") out[k] = v;
  }
  return out;
}

function escapeRegExp(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTrailingCityFromPerformer(performer_query, city) {
  const p = normSpace(performer_query);
  const c = normSpace(city);
  if (!p || !c) return performer_query;

  const re = new RegExp(`\\s*(?:[-–|•,:]+\\s*)?${escapeRegExp(c)}\\s*$`, "i");
  if (re.test(p)) {
    const out = normSpace(p.replace(re, ""));
    return out || performer_query;
  }
  return performer_query;
}

function stripTicketsWord(s) {
  return normSpace(String(s || "").replace(/\bTickets?\b/ig, "").replace(/\s*[-–|•,:]\s*$/g, ""));
}

/**
 * =========================
 * Ticketmaster (title fallback)
 * =========================
 */
function parseTicketmasterTitle(title) {
  const t = normSpace(title);
  if (!t) return null;

  const left = t.split("|")[0].trim();

  const mLoc =
    /(\b[A-Za-z]{3}\b)\s+\d{1,2},\s+\d{4}\s+(.+?),\s+([A-Z]{2})\b/.exec(left);
  let city = null;
  let state = null;

  if (mLoc) {
    city = normSpace(mLoc[2]);
    state = normSpace(mLoc[3]);
  } else {
    const m2 = /(.+?),\s+([A-Z]{2})\s*$/.exec(left);
    if (m2) {
      city = normSpace(m2[1]);
      state = normSpace(m2[2]);
    }
  }

  let date_day = null;
  const mDate =
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b\s+(\d{1,2}),\s+(\d{4})/i.exec(
      left
    );
  if (mDate) {
    const mon = mDate[1].toLowerCase();
    const dd = String(mDate[2]).padStart(2, "0");
    const yyyy = mDate[3];
    const mm = MONTH_MAP[mon.slice(0, 3)];
    if (mm) date_day = `${yyyy}-${mm}-${dd}`;
  }

  let performer_query = null;
  const idxTickets = left.toLowerCase().indexOf(" tickets ");
  if (idxTickets > 0) {
    performer_query = normSpace(left.slice(0, idxTickets));
  } else if (mDate && mDate.index > 0) {
    performer_query = normSpace(left.slice(0, mDate.index));
  }

  return {
    raw_title: t,
    performer_query: performer_query || null,
    city: city || null,
    state: state || null,
    date_day,
    time_24: null
  };
}

/**
 * =========================
 * StubHub: get DATE from URL reliably + improved multi-word city heuristic
 * =========================
 */
function titleCaseWords(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// 1) starters (las/el/san/...)
const MULTI_CITY_STARTERS = new Set([
  "las", "el", "los", "san", "santa", "new", "fort", "ft", "st", "saint",
  "port", "palm", "glen", "grand", "little", "cedar", "rapid", "salt", "sioux"
]);

// 2) “second word” suffixes for 2-word US cities (ann-arbor, east-rutherford, vero-beach, palm-springs...)
const CITY_SECOND_WORDS = new Set([
  "arbor", "rutherford", "beach", "springs", "heights", "falls", "rapids", "lake",
  "valley", "park", "grove", "hills", "harbor", "harbour", "mesa", "vista",
  "mont", "mount", "junction", "station", "center", "centre", "bay", "point",
  "island", "ridge", "town", "city"
]);

// also directional first-words commonly used (east-rutherford, north-charleston...)
const CITY_FIRST_WORDS = new Set(["east", "west", "north", "south", "upper", "lower", "old", "new"]);

function splitStubhubSlugIntoPerformerAndCity(parts) {
  if (!parts || parts.length < 2) return { performerSlug: null, citySlug: null };

  const n = parts.length;

  // salt-lake-city / salt-lake
  if (n >= 3 && parts[n - 3] === "salt" && parts[n - 2] === "lake") {
    if (parts[n - 1] === "city" && n >= 4) {
      return {
        performerSlug: parts.slice(0, n - 3).join("-"),
        citySlug: parts.slice(n - 3).join("-")
      };
    }
    return {
      performerSlug: parts.slice(0, n - 2).join("-"),
      citySlug: parts.slice(n - 2).join("-")
    };
  }

  // starter-based two-word city
  if (n >= 2 && MULTI_CITY_STARTERS.has(parts[n - 2])) {
    return {
      performerSlug: parts.slice(0, n - 2).join("-"),
      citySlug: parts.slice(n - 2).join("-")
    };
  }

  // “directional + noun” two-word cities (east-rutherford etc.)
  if (n >= 2 && CITY_FIRST_WORDS.has(parts[n - 2])) {
    return {
      performerSlug: parts.slice(0, n - 2).join("-"),
      citySlug: parts.slice(n - 2).join("-")
    };
  }

  // suffix-based two-word cities (ann-arbor, ...-springs, ...-beach, ...-heights, ...-rutherford)
  if (n >= 2 && CITY_SECOND_WORDS.has(parts[n - 1])) {
    return {
      performerSlug: parts.slice(0, n - 2).join("-"),
      citySlug: parts.slice(n - 2).join("-")
    };
  }

  // "...-city" take last 3 (oklahoma-city)
  if (n >= 3 && parts[n - 1] === "city") {
    return {
      performerSlug: parts.slice(0, n - 3).join("-"),
      citySlug: parts.slice(n - 3).join("-")
    };
  }

  // Default: 1-token city
  return {
    performerSlug: parts.slice(0, n - 1).join("-"),
    citySlug: parts.slice(n - 1).join("-")
  };
}

function parseStubHubDateFromUrl() {
  const host = hostname();
  if (!host.includes("stubhub.")) return null;

  const p = String(location.pathname || "");

  const m = /-tickets-(\d{1,2})-(\d{1,2})-(\d{4})\/event\/\d+/i.exec(p);
  if (!m) return null;

  const mm = String(m[1]).padStart(2, "0");
  const dd = String(m[2]).padStart(2, "0");
  const yyyy = m[3];

  const left = p.split("-tickets-")[0].replace(/^\//, "");
  const parts = left.split("-").filter(Boolean);

  let performer_query = null;
  let city = null;

  if (parts.length >= 2) {
    const { performerSlug, citySlug } = splitStubhubSlugIntoPerformerAndCity(parts);
    if (performerSlug) performer_query = titleCaseWords(performerSlug);
    if (citySlug) city = titleCaseWords(citySlug);
  }

  return {
    raw_title: document.title?.trim() || null,
    performer_query: performer_query || null,
    city: city || null,
    state: null,
    date_day: `${yyyy}-${mm}-${dd}`,
    time_24: null
  };
}

// StubHub time fallback from meta/body text
function extractStubhubTimeFallback() {
  const host = hostname();
  if (!host.includes("stubhub.")) return null;

  const ogDesc = getMeta("og:description") || "";
  const desc = getMeta("description") || "";
  const ogTitle = getMeta("og:title") || "";
  const docTitle = document.title || "";

  const text = [ogTitle, ogDesc, desc, docTitle, normSpace(document.body?.innerText || "").slice(0, 8000)]
    .filter(Boolean)
    .join(" | ");

  const time_24 = parseTime12(text);
  if (!time_24) return null;

  return { time_24 };
}

/**
 * ==================================
 * JSON-LD Event extractor (generic)
 * ==================================
 */
function tryParseJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}
function collectJsonLdObjects() {
  const nodes = Array.from(
    document.querySelectorAll('script[type="application/ld+json"]')
  );
  const out = [];
  for (const n of nodes) {
    const txt = n.textContent?.trim();
    if (!txt) continue;
    const parsed = tryParseJson(txt);
    if (!parsed) continue;

    if (Array.isArray(parsed)) out.push(...parsed);
    else out.push(parsed);
  }
  return out;
}
function findEventInJsonLd(obj) {
  const isEvent = (x) => {
    const t = x?.["@type"];
    if (!t) return false;
    if (Array.isArray(t)) return t.some((z) => /event/i.test(String(z)));
    return /event/i.test(String(t));
  };
  if (isEvent(obj)) return obj;
  if (Array.isArray(obj?.["@graph"])) {
    const e = obj["@graph"].find(isEvent);
    if (e) return e;
  }
  return null;
}
function parseIsoStartDate(startDate) {
  if (!startDate) return { date_day: null, time_24: null };
  const s = String(startDate).trim();
  if (!s) return { date_day: null, time_24: null };

  const mDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const date_day = mDate ? `${mDate[1]}-${mDate[2]}-${mDate[3]}` : null;

  const mTime = /T(\d{2}):(\d{2})/.exec(s);
  const time_24 = mTime ? `${mTime[1]}:${mTime[2]}` : null;

  return { date_day, time_24 };
}

function parseCityStateFromString(s) {
  const t = normSpace(s);
  if (!t) return { city: null, state: null };

  const m = /^([^,]+?),\s*([A-Z]{2})\b/.exec(t);
  if (m) return { city: normSpace(m[1]), state: normSpace(m[2]) };

  const m2 = /^(.+?)\s+([A-Z]{2})\b/.exec(t);
  if (m2) return { city: normSpace(m2[1]), state: normSpace(m2[2]) };

  return { city: null, state: null };
}

function extractFromEventJsonLd(ev) {
  if (!ev || typeof ev !== "object") return null;

  const raw_title =
    normSpace(ev.name) ||
    normSpace(getMeta("og:title")) ||
    normSpace(document.title) ||
    null;

  let performer_query = null;
  const perf = ev.performer || ev.performers || ev.artist || null;

  const pickPerfName = (p) => {
    if (!p) return null;
    if (typeof p === "string") return normSpace(p);
    if (Array.isArray(p)) {
      for (const it of p) {
        const n = pickPerfName(it);
        if (n) return n;
      }
      return null;
    }
    return normSpace(p.name) || null;
  };
  performer_query = pickPerfName(perf);

  // startDate or "startDate" variants sometimes nested (rare)
  const { date_day, time_24 } = parseIsoStartDate(ev.startDate || ev.start_date || ev.dateTime || ev.datetime);

  let city = null;
  let state = null;

  const loc = ev.location || null;

  const pickAddress = (x) => {
    if (!x) return null;

    const addr = x.address || null;

    if (typeof addr === "string") {
      const cs = parseCityStateFromString(addr);
      if (cs.city) return cs;
    }
    if (addr && typeof addr === "object") {
      const city0 = addr.addressLocality || addr.addressCity || null;
      const state0 = addr.addressRegion || null;
      if (city0) return { city: normSpace(city0), state: normSpace(state0) || null };
    }

    if (typeof x === "string") {
      const cs = parseCityStateFromString(x);
      if (cs.city) return cs;
    }

    return null;
  };

  if (Array.isArray(loc)) {
    for (const l of loc) {
      const a = pickAddress(l);
      if (a?.city) {
        city = a.city;
        state = a.state || null;
        break;
      }
    }
  } else {
    const a = pickAddress(loc);
    if (a?.city) {
      city = a.city;
      state = a.state || null;
    }
  }

  if (!performer_query && raw_title && city) {
    performer_query = stripTrailingCityFromPerformer(raw_title, city);
  }

  if (!raw_title && !performer_query && !city && !date_day && !time_24) return null;

  return {
    raw_title,
    performer_query: performer_query || null,
    city: city || null,
    state: state || null,
    date_day: date_day || null,
    time_24: time_24 || null
  };
}
function extractFromJsonLd() {
  const objs = collectJsonLdObjects();
  if (!objs.length) return null;

  for (const obj of objs) {
    const ev = findEventInJsonLd(obj);
    if (!ev) continue;
    const ctx = extractFromEventJsonLd(ev);
    if (ctx) return ctx;
  }
  return null;
}

/**
 * ============================================
 * Next.js / application-json deep event extractor (good for Viagogo)
 * ============================================
 */
function deepFindFirst(root, predicate) {
  const seen = new Set();
  function walk(x) {
    if (!x || typeof x !== "object") return null;
    if (seen.has(x)) return null;
    seen.add(x);

    if (predicate(x)) return x;

    if (Array.isArray(x)) {
      for (const it of x) {
        const r = walk(it);
        if (r) return r;
      }
      return null;
    }

    for (const v of Object.values(x)) {
      const r = walk(v);
      if (r) return r;
    }
    return null;
  }
  return walk(root);
}

function extractEventFieldsFromObject(ev) {
  if (!ev || typeof ev !== "object") return null;

  // Try many possible keys
  const name =
    ev.name || ev.title || ev.eventName || ev.event_name || ev.performanceName || null;

  const venueName =
    ev.venueName ||
    ev.venue_name ||
    ev.venue?.name ||
    ev.location?.name ||
    ev.place?.name ||
    null;

  // start date candidates
  const start =
    ev.startDate ||
    ev.start_date ||
    ev.dateTime ||
    ev.datetime ||
    ev.eventDateTime ||
    ev.event_date_time ||
    ev.eventDate ||
    ev.event_date ||
    null;

  // city/state candidates
  let city = null;
  let state = null;

  const cityCand =
    ev.city ||
    ev.venueCity ||
    ev.venue_city ||
    ev.locationCity ||
    ev.location_city ||
    ev.address?.city ||
    ev.address?.addressLocality ||
    ev.location?.address?.addressLocality ||
    ev.location?.address?.addressCity ||
    ev.venue?.address?.addressLocality ||
    null;

  const stateCand =
    ev.state ||
    ev.region ||
    ev.venueState ||
    ev.venue_state ||
    ev.address?.state ||
    ev.address?.addressRegion ||
    ev.location?.address?.addressRegion ||
    ev.venue?.address?.addressRegion ||
    null;

  if (typeof cityCand === "string") city = normSpace(cityCand);
  if (typeof stateCand === "string") state = normSpace(stateCand);

  // sometimes location is a single string "El Paso, TX"
  const locStr =
    (typeof ev.location === "string" ? ev.location : null) ||
    (typeof ev.venue === "string" ? ev.venue : null) ||
    null;

  if (!city && locStr) {
    const cs = parseCityStateFromString(locStr);
    if (cs.city) {
      city = cs.city;
      state = cs.state || state;
    }
  }

  // If no direct city, try parsing from a formatted address string
  const addrStr =
    (typeof ev.address === "string" ? ev.address : null) ||
    (typeof ev.formattedAddress === "string" ? ev.formattedAddress : null) ||
    (typeof ev.venueAddress === "string" ? ev.venueAddress : null) ||
    null;

  if (!city && addrStr) {
    const cs = parseCityStateFromString(addrStr);
    if (cs.city) {
      city = cs.city;
      state = cs.state || state;
    }
  }

  // Parse ISO start if possible
  const { date_day, time_24 } = parseIsoStartDate(start);

  // Fallback: parse human date/time strings if present
  const date2 = !date_day && typeof start === "string" ? (parseMonthDateYear(start) || parseNumericDate(start)) : null;
  const time2 = !time_24 && typeof start === "string" ? parseTime12(start) : null;

  const out = {
    raw_title: normSpace(name) || normSpace(getMeta("og:title")) || normSpace(document.title) || null,
    performer_query: normSpace(name) || null,
    city: city || null,
    state: state || null,
    date_day: date_day || date2 || null,
    time_24: time_24 || time2 || null,
    venue_name: normSpace(venueName) || null
  };

  // must have at least something meaningful besides raw_title
  const hasAny = out.performer_query || out.city || out.date_day || out.time_24 || out.venue_name;
  return hasAny ? out : null;
}

function extractFromNextDataEventLike() {
  // Candidate scripts: __NEXT_DATA__ and any application/json blobs
  const scripts = [
    document.querySelector('script[id="__NEXT_DATA__"]'),
    document.querySelector('script[type="application/json"][id="__NEXT_DATA__"]')
  ].filter(Boolean);

  const allJsonScripts = Array.from(document.querySelectorAll('script[type="application/json"]'));
  for (const s of allJsonScripts) scripts.push(s);

  for (const sc of scripts) {
    const txt = sc?.textContent?.trim();
    if (!txt || txt.length < 80) continue;

    const parsed = tryParseJson(txt);
    if (!parsed || typeof parsed !== "object") continue;

    // event-like predicate: has any of date keys AND any of name keys
    const found = deepFindFirst(parsed, (o) => {
      if (!o || typeof o !== "object") return false;
      const hasName = typeof (o.name || o.title || o.eventName || o.event_name) === "string";
      const hasDate = typeof (o.startDate || o.dateTime || o.datetime || o.eventDateTime || o.eventDate || o.event_date) === "string";
      return hasName && hasDate;
    });

    if (!found) continue;

    const ctx = extractEventFieldsFromObject(found);
    if (!ctx) continue;

    // Build performer_query with venue for viagogo-style expectations
    let performer_query = ctx.performer_query || null;
    if (performer_query) performer_query = stripTicketsWord(performer_query);

    // If venue exists and performer doesn't already include it, append
    if (performer_query && ctx.venue_name) {
      const v = normSpace(ctx.venue_name);
      if (v && !new RegExp(escapeRegExp(v), "i").test(performer_query)) {
        performer_query = normSpace(`${performer_query} ${v}`);
      }
    }

    // If city known, avoid leaving it at end of performer
    if (performer_query && ctx.city) performer_query = stripTrailingCityFromPerformer(performer_query, ctx.city);

    return {
      raw_title: ctx.raw_title,
      performer_query,
      city: ctx.city,
      state: ctx.state,
      date_day: ctx.date_day,
      time_24: ctx.time_24
    };
  }

  return null;
}

/**
 * ============================================
 * Viagogo meta/text fallback (only if NextData fails)
 * ============================================
 */
function parseViagogoFromText(text) {
  const t = normSpace(text);
  if (!t) return null;

  const date_day = parseMonthDateYear(t) || null;
  const time_24 = parseTime12(t) || null;

  let city = null;
  let state = null;

  const mIn = /\bin\s+([A-Za-z .'-]+?),\s*([A-Z]{2})\b/.exec(t);
  if (mIn) {
    city = normSpace(mIn[1]);
    state = normSpace(mIn[2]);
  }

  let venue = null;
  const mAtIn = /\bat\s+(.+?)\s+\bin\s+[A-Za-z .'-]+?,\s*[A-Z]{2}\b/i.exec(t);
  if (mAtIn) venue = normSpace(mAtIn[1]);

  if (!city && !date_day && !time_24 && !venue) return null;
  return { city, state, date_day, time_24, venue };
}

function extractFromViagogoSmart() {
  const host = hostname();
  if (!host.includes("viagogo.")) return null;

  const h1 = normSpace(document.querySelector("h1")?.textContent || "");
  const ogTitle = getMeta("og:title") || "";
  const ogDesc = getMeta("og:description") || "";
  const desc = getMeta("description") || "";
  const twDesc = getMeta("twitter:description") || "";
  const docTitle = document.title || "";

  const bigText = [
    ogDesc, desc, twDesc, ogTitle, docTitle,
    normSpace(document.body?.innerText || "").slice(0, 12000)
  ].filter(Boolean).join(" | ");

  const parsed = parseViagogoFromText(bigText);
  if (!parsed) return null;

  const city = parsed.city || null;
  const state = parsed.state || null;
  const date_day = parsed.date_day || null;
  const time_24 = parsed.time_24 || null;
  const venue = parsed.venue || null;

  let performer_query =
    stripTicketsWord(h1) ||
    stripTicketsWord(ogTitle) ||
    stripTicketsWord(docTitle) ||
    null;

  if (performer_query && city) performer_query = stripTrailingCityFromPerformer(performer_query, city);

  if (performer_query && venue) {
    const v = normSpace(venue);
    if (v && !new RegExp(escapeRegExp(v), "i").test(performer_query)) {
      performer_query = normSpace(`${performer_query} ${v}`);
    }
  }

  const raw_title = normSpace(ogTitle) || normSpace(docTitle) || performer_query || null;

  return {
    raw_title,
    performer_query: performer_query || null,
    city,
    state,
    date_day,
    time_24
  };
}

/**
 * ============================================
 * Meta/title heuristics (generic)
 * ============================================
 */
function parseGenericText(text) {
  const t = normSpace(text);
  if (!t) return null;

  const date_day = parseMonthDateYear(t) || parseNumericDate(t) || null;
  const time_24 = parseTime12(t);

  let city = null;
  let state = null;

  const mInCitySt = /\bin\s+([A-Za-z .'-]+?),\s*([A-Z]{2})\b/.exec(t);
  if (mInCitySt) {
    city = normSpace(mInCitySt[1]);
    state = normSpace(mInCitySt[2]);
  } else {
    const mInCityStop =
      /\bin\s+([A-Za-z .'-]+?)(?:\s+tickets\b|,|\s+on\b|\s+at\b|\s+-|\s+\||$)/i.exec(
        t
      );
    if (mInCityStop) {
      city = normSpace(mInCityStop[1]);
    } else {
      const all = Array.from(t.matchAll(/([^,]+?),\s+([A-Z]{2})\b/g));
      if (all.length) {
        const last = all[all.length - 1];
        city = normSpace(last[1]);
        state = normSpace(last[2]);
      }
    }
  }

  let performer_query = null;
  const idxTickets = safeLower(t).indexOf(" tickets");
  if (idxTickets > 0) performer_query = normSpace(t.slice(0, idxTickets));
  else {
    const h1 = document.querySelector("h1")?.textContent?.trim();
    if (h1) performer_query = normSpace(h1);
  }

  if (performer_query && city) {
    performer_query = stripTrailingCityFromPerformer(performer_query, city);
  }

  return {
    raw_title: t,
    performer_query: performer_query || null,
    city: city || null,
    state: state || null,
    date_day,
    time_24: time_24 || null
  };
}

function extractFromOgMetaSmart() {
  const ogTitle = getMeta("og:title");
  const ogDesc = getMeta("og:description");
  const docTitle = document.title || "";

  const ctxTitle = ogTitle ? parseGenericText(ogTitle) : null;
  const ctxDesc = ogDesc ? parseGenericText(ogDesc) : null;
  const ctxDoc = docTitle ? parseGenericText(docTitle) : null;

  let out = null;
  if (ctxTitle) out = mergeCtxFillMissing(out, ctxTitle);
  if (ctxDesc) out = mergeCtxFillMissing(out, ctxDesc);
  if (ctxDoc) out = mergeCtxFillMissing(out, ctxDoc);

  return out;
}

/**
 * =========
 * Fallback
 * =========
 */
function fallbackExtract() {
  const raw_title =
    document.querySelector("h1")?.textContent?.trim() ||
    getMeta("og:title") ||
    document.title?.trim() ||
    null;

  return {
    raw_title,
    performer_query: null,
    city: null,
    state: null,
    date_day: null,
    time_24: null
  };
}

function buildTestContext() {
  return {
    raw_title: document.title,
    performer_query: "Chris Stapleton",
    city: "Houston",
    state: "TX",
    date_day: "2026-03-12",
    time_24: "18:45"
  };
}

async function handleGetContext() {
  if (DEBUG_FORCE_TEST) {
    return { ok: true, source: "debug_test", context: buildTestContext() };
  }

  const host = hostname();
  const title = document.title || "";

  const isTicketmaster = host.includes("ticketmaster.") || safeLower(title).includes("ticketmaster");
  const isViagogo = host.includes("viagogo.");
  const isStubhub = host.includes("stubhub.");

  /**
   * 1) Ticketmaster: JSON-LD first (for time), then title fallback
   */
  if (isTicketmaster) {
    const tmJson = extractFromJsonLd();
    if (tmJson) return { ok: true, source: "ticketmaster_jsonld", context: tmJson };

    const tm = parseTicketmasterTitle(title);
    if (tm) return { ok: true, source: "ticketmaster_title", context: tm };
    // continue if both fail
  }

  /**
   * 2) JSON-LD universal
   */
  const jsonld = extractFromJsonLd();
  if (jsonld) return { ok: true, source: "jsonld_event", context: jsonld };

  /**
   * 3) NextData/application-json deep event extractor (critical for Viagogo)
   */
  const nextEv = extractFromNextDataEventLike();
  if (nextEv) return { ok: true, source: "nextdata_eventlike", context: nextEv };

  /**
   * 4) Viagogo meta/text fallback
   */
  if (isViagogo) {
    const vg = extractFromViagogoSmart();
    if (vg) return { ok: true, source: "viagogo_smart", context: vg };
  }

  /**
   * 5) OG/meta smart merge
   */
  const og = extractFromOgMetaSmart();

  /**
   * 6) StubHub: merge URL date + meta time fallback (and keep any og fields)
   */
  if (isStubhub) {
    const sh = parseStubHubDateFromUrl();
    const shTime = extractStubhubTimeFallback();
    const merged1 = mergeCtxOverwrite(og, sh);
    const merged2 = mergeCtxOverwrite(merged1, shTime);
    return {
      ok: true,
      source: "stubhub_merge",
      context: merged2 || merged1 || sh || og || fallbackExtract()
    };
  }

  if (og) return { ok: true, source: "meta_smart", context: og };

  /**
   * 7) Fallback
   */
  return { ok: true, source: "fallback", context: fallbackExtract() };
}

// IMPORTANT: async handler returns a Promise -> polyfill will send it back
browser.runtime.onMessage.addListener(async (msg) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "GET_PAGE_CONTEXT") {
    const resp = await handleGetContext();
    console.log("[TR] GET_PAGE_CONTEXT received, replying with:", resp);
    return resp;
  }
});