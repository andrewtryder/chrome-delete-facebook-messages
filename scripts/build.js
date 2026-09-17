#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "manifest.json");
const DIST_DIR = path.join(ROOT, "dist");
const DEV_DIR = path.join(DIST_DIR, "dev");
const PROD_DIR = path.join(DIST_DIR, "prod");

const LOCALHOST_MATCHES = [
  "http://127.0.0.1:4173/*",
  "http://localhost:4173/*",
];

// Explicit required runtime files for extension package
const EXPLICIT_RUNTIME_FILES = [
  { src: "background.js", dest: "background.js" },
  { src: "js/script.js", dest: "js/script.js" },
  { src: "icons/16.png", dest: "icons/16.png" },
  { src: "icons/32.png", dest: "icons/32.png" },
  { src: "icons/48.png", dest: "icons/48.png" },
  { src: "icons/128.png", dest: "icons/128.png" },
  { src: "icons/256.png", dest: "icons/256.png" },
  { src: "src/browser_action/browser_action.html", dest: "src/browser_action/browser_action.html" },
  { src: "src/browser_action/css/style.css", dest: "src/browser_action/css/style.css" },
  { src: "src/browser_action/js/browser_action.js", dest: "src/browser_action/js/browser_action.js" },
  { src: "src/browser_action/assets/logo.svg", dest: "src/browser_action/assets/logo.svg" },
  { src: "LICENSE", dest: "LICENSE" },
];

function cleanDir(targetDir) {
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });
}

function copyExtensionAssets(targetDir) {
  cleanDir(targetDir);

  for (const item of EXPLICIT_RUNTIME_FILES) {
    const srcPath = path.join(ROOT, item.src);
    const destPath = path.join(targetDir, item.dest);
    if (fs.existsSync(srcPath)) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    } else {
      console.warn(`Warning: Expected asset file not found: ${item.src}`);
    }
  }
}

function build() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`manifest.json not found at ${MANIFEST_PATH}`);
    process.exit(1);
  }

  const rawManifest = fs.readFileSync(MANIFEST_PATH, "utf8");
  const baseManifest = JSON.parse(rawManifest);

  // 1. Verify source manifest has no localhost matches
  const baseMatches = baseManifest.content_scripts?.[0]?.matches || [];
  const illegalMatches = baseMatches.filter(
    (m) => m.includes("localhost") || m.includes("127.0.0.1"),
  );
  if (illegalMatches.length > 0) {
    console.error("❌ Root manifest.json contains localhost matches; must remain pristine production manifest.", illegalMatches);
    process.exit(1);
  }

  // 2. Build dist/prod
  console.log("📦 Building dist/prod extension...");
  copyExtensionAssets(PROD_DIR);
  fs.writeFileSync(
    path.join(PROD_DIR, "manifest.json"),
    JSON.stringify(baseManifest, null, 2) + "\n",
    "utf8",
  );
  console.log("✅ dist/prod built successfully.");

  // 3. Build dist/dev (with localhost matches for fixture testing)
  console.log("📦 Building dist/dev extension...");
  copyExtensionAssets(DEV_DIR);
  const devManifest = JSON.parse(JSON.stringify(baseManifest));
  if (devManifest.content_scripts && devManifest.content_scripts[0]) {
    const set = new Set(devManifest.content_scripts[0].matches || []);
    LOCALHOST_MATCHES.forEach((m) => set.add(m));
    devManifest.content_scripts[0].matches = Array.from(set);
  }
  fs.writeFileSync(
    path.join(DEV_DIR, "manifest.json"),
    JSON.stringify(devManifest, null, 2) + "\n",
    "utf8",
  );
  console.log("✅ dist/dev built successfully with localhost test matches.");
}

if (require.main === module) {
  build();
}

module.exports = { build, LOCALHOST_MATCHES };
