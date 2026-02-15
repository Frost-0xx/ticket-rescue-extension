#!/usr/bin/env node

/**
 * Build Ticket Rescue extension into ./dist
 *
 * Usage:
 *   node scripts/build-manifest.js prod
 *   node scripts/build-manifest.js dev
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const ENV = (process.argv[2] || "prod").toLowerCase();
if (!["prod", "dev"].includes(ENV)) {
  console.error(`Unknown env "${ENV}". Use "prod" or "dev".`);
  process.exit(1);
}

// ---- EDIT THESE ONCE ----
const PROD = {
  NAME: "Ticket Rescue",
  DESCRIPTION:
    "Compare ticket offers and promo deals instantly while browsing event pages.",
  VERSION: "1.0.0"
};

const DEV = {
  NAME: "Ticket Rescue (DEV)",
  DESCRIPTION:
    "DEV build. Compare ticket offers and promo deals instantly while browsing event pages.",
  VERSION: "1.0.0-dev"
};

// Supported MVP sites
const HOSTS = [
  "https://www.ticketmaster.com/*",
  "https://www.stubhub.com/*",
  "https://www.vividseats.com/*",
  "https://seatgeek.com/*",
  "https://api.geturtix.com/*"
];

// Icons (paths relative to extension root)
const ICONS = {
  "16": "assets/icon-16.png",
  "32": "assets/icon-32.png",
  "48": "assets/icon-48.png",
  "128": "assets/icon-128.png"
};

// Build flags consumed by popup.js via config/build.json
function buildFlags(env) {
  if (env === "dev") {
    return {
      ENV: "dev",
      FLAGS: { DEBUG_UI: true, DEBUG_LOGS: true }
    };
  }
  return {
    ENV: "prod",
    FLAGS: { DEBUG_UI: false, DEBUG_LOGS: false }
  };
}

// ---- helpers ----
function rmDirSafe(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  ensureDir(dst);
  fs.cpSync(src, dst, { recursive: true });
}

function writeJson(filePath, obj) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

/**
 * Replace placeholders inside a JSON string safely.
 * We stringify the template object, replace placeholder tokens, then JSON.parse.
 */
function buildManifestFromTemplate(tplObj, replacements) {
  let s = JSON.stringify(tplObj);

  // Simple string replacements
  const simpleKeys = ["__NAME__", "__VERSION__", "__DESCRIPTION__", "__ICON16__", "__ICON32__", "__ICON48__", "__ICON128__"];
  for (const k of simpleKeys) {
    const v = replacements[k];
    if (typeof v !== "string") continue;
    // replace JSON string value: "__NAME__" -> "Ticket Rescue"
    s = s.replaceAll(JSON.stringify(k), JSON.stringify(v));
  }

  // Array replacements: host_permissions and matches
  // In template these are JSON strings "__HOST_PERMISSIONS__" and "__MATCHES__"
  s = s.replaceAll(JSON.stringify("__HOST_PERMISSIONS__"), JSON.stringify(replacements["__HOST_PERMISSIONS__"]));
  s = s.replaceAll(JSON.stringify("__MATCHES__"), JSON.stringify(replacements["__MATCHES__"]));

  const out = JSON.parse(s);

  // Hard safety checks
  if (!Array.isArray(out.host_permissions)) {
    throw new Error("host_permissions must be an array after build");
  }
  const cs0 = out.content_scripts?.[0];
  if (!Array.isArray(cs0?.matches)) {
    throw new Error("content_scripts[0].matches must be an array after build");
  }

  return out;
}

function main() {
  console.log(`[build] env=${ENV}`);

  // 1) reset dist
  rmDirSafe(DIST);
  ensureDir(DIST);

  // 2) load template
  const templatePath = path.join(ROOT, "manifest.template.js");
  if (!fs.existsSync(templatePath)) {
    console.error(`[build] Missing manifest.template.js at ${templatePath}`);
    process.exit(1);
  }
  delete require.cache[require.resolve(templatePath)];
  const tpl = require(templatePath);

  const meta = ENV === "dev" ? DEV : PROD;

  const replacements = {
    "__NAME__": meta.NAME,
    "__VERSION__": meta.VERSION,
    "__DESCRIPTION__": meta.DESCRIPTION,
    "__ICON16__": ICONS["16"],
    "__ICON32__": ICONS["32"],
    "__ICON48__": ICONS["48"],
    "__ICON128__": ICONS["128"],
    "__HOST_PERMISSIONS__": HOSTS,
    "__MATCHES__": HOSTS
  };

  // 3) build manifest object
  let manifestObj;
  try {
    manifestObj = buildManifestFromTemplate(tpl, replacements);
  } catch (e) {
    console.error(`[build] Failed to build manifest: ${e.message || e}`);
    process.exit(1);
  }

  // 4) write dist/manifest.json
  writeJson(path.join(DIST, "manifest.json"), manifestObj);

  // 5) write dist/config/build.json (popup reads this)
  writeJson(path.join(DIST, "config", "build.json"), buildFlags(ENV));

  // 6) copy runtime folders
  copyDir(path.join(ROOT, "src"), path.join(DIST, "src"));
  copyDir(path.join(ROOT, "vendor"), path.join(DIST, "vendor"));
  copyDir(path.join(ROOT, "assets"), path.join(DIST, "assets"));

  // optional: copy your config/, but keep generated build.json
  const configSrc = path.join(ROOT, "config");
  if (fs.existsSync(configSrc)) {
    copyDir(configSrc, path.join(DIST, "config"));
    writeJson(path.join(DIST, "config", "build.json"), buildFlags(ENV));
  }

  console.log(`[build] done: ${DIST}`);
}

main();