const fs = require("fs");
const path = require("path");

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeFile(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function rmDir(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function replacePlaceholders(obj, cfg) {
  const walk = (x) => {
    if (typeof x === "string") {
      return x
        .replaceAll("__NAME__", cfg.NAME)
        .replaceAll("__VERSION__", cfg.VERSION)
        .replaceAll("__DESCRIPTION__", cfg.DESCRIPTION)
        .replaceAll("__ICON16__", cfg.ICONS["16"])
        .replaceAll("__ICON48__", cfg.ICONS["48"])
        .replaceAll("__ICON128__", cfg.ICONS["128"]);
    }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") {
      const out = {};
      for (const [k, v] of Object.entries(x)) out[k] = walk(v);
      return out;
    }
    return x;
  };

  const out = walk(obj);

  // Inject arrays where template has placeholders
  if (out.host_permissions === "__HOST_PERMISSIONS__") {
    out.host_permissions = cfg.HOST_PERMISSIONS;
  }
  if (
    out.content_scripts &&
    out.content_scripts[0] &&
    out.content_scripts[0].matches === "__MATCHES__"
  ) {
    out.content_scripts[0].matches = cfg.MATCHES;
  }

  return out;
}

function build(env) {
  const root = path.resolve(__dirname, "..");
  const dist = path.join(root, "dist", env);

  const cfg = readJSON(path.join(root, "config", `build.${env}.json`));

  // Copy full project into dist/<env>
  rmDir(dist);
  copyDir(root, dist);

  // Remove build-only stuff from dist
  rmDir(path.join(dist, "dist"));
  rmDir(path.join(dist, "tools"));
  rmDir(path.join(dist, "config")); // we will recreate config/build.json below

  // Remove template from dist (if present)
  if (fs.existsSync(path.join(dist, "manifest.template.js"))) {
    fs.unlinkSync(path.join(dist, "manifest.template.js"));
  }
  if (fs.existsSync(path.join(dist, "manifest.template.json"))) {
    fs.unlinkSync(path.join(dist, "manifest.template.json"));
  }

  // Create config/build.json inside dist (read by popup)
  writeFile(
    path.join(dist, "config", "build.json"),
    JSON.stringify({ ENV: cfg.ENV, FLAGS: cfg.FLAGS }, null, 2)
  );

  // Generate manifest.json from JS template
  const templateObj = require(path.join(root, "manifest.template.js"));
  const manifestObj = replacePlaceholders(templateObj, cfg);

  writeFile(path.join(dist, "manifest.json"), JSON.stringify(manifestObj, null, 2));

  console.log(`[build] OK -> ${dist}`);
}

// CLI
const env = process.argv[2];
if (!["dev", "prod"].includes(env)) {
  console.log("Usage: node tools/build.js dev|prod");
  process.exit(1);
}
build(env);