#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const MANIFEST_PATH = path.resolve(__dirname, "../manifest.json");

const LOCALHOST_MATCHES = [
  "http://127.0.0.1:4173/*",
  "http://localhost:4173/*",
];

const PROD_MATCHES = [
  "https://*.facebook.com/*",
  "https://*.messenger.com/*",
];

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function writeManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

const mode = process.argv[2] || "--check";

const manifest = readManifest();
const contentScript = manifest.content_scripts && manifest.content_scripts[0];

if (!contentScript) {
  console.error("No content_scripts found in manifest.json");
  process.exit(1);
}

if (mode === "--dev") {
  const currentMatches = new Set(contentScript.matches || []);
  LOCALHOST_MATCHES.forEach((m) => currentMatches.add(m));
  contentScript.matches = Array.from(currentMatches);
  writeManifest(manifest);
  console.log("✅ Development matches added to manifest.json (localhost / 127.0.0.1).");
} else if (mode === "--prod") {
  contentScript.matches = (contentScript.matches || []).filter(
    (m) => !LOCALHOST_MATCHES.includes(m) && !m.includes("localhost") && !m.includes("127.0.0.1")
  );
  writeManifest(manifest);
  console.log("✅ Production matches restored in manifest.json (no localhost entries).");
} else if (mode === "--check") {
  const forbidden = (contentScript.matches || []).filter(
    (m) => m.includes("localhost") || m.includes("127.0.0.1")
  );
  if (forbidden.length > 0) {
    console.error("❌ Manifest contains localhost matches for production shipping:", forbidden);
    process.exit(1);
  }
  console.log("✅ Manifest is clean for production shipping (no localhost matches).");
} else {
  console.error("Usage: node scripts/dev-manifest.js [--dev|--prod|--check]");
  process.exit(1);
}
