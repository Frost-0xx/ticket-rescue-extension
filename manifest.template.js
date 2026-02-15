module.exports = {
  manifest_version: 3,
  name: "__NAME__",
  version: "__VERSION__",
  description: "__DESCRIPTION__",

  action: {
    default_popup: "src/popup.html"
  },

  background: {
    service_worker: "src/background.js"
  },

  icons: {
    "16": "__ICON16__",
    "32": "__ICON32__",
    "48": "__ICON48__",
    "128": "__ICON128__"
  },

  permissions: ["storage"],

  // keep as a STRING placeholder; build will replace with JSON array
  host_permissions: "__HOST_PERMISSIONS__",

  content_scripts: [
    {
      // keep as a STRING placeholder; build will replace with JSON array
      matches: "__MATCHES__",
      js: ["vendor/browser-polyfill.min.js", "src/content.js"],
      run_at: "document_idle"
    }
  ]
};