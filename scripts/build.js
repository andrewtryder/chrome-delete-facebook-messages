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

const ASSET_DIRS = [
  "css",
  "icons",
  "js",
  "src/browser_action",
];

const ASSET_FILES = [
  "background.js",
];

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function copyExtensionAssets(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const dir of ASSET_DIRS) {
    copyRecursive(path.join(ROOT, dir), path.join(targetDir, dir));
  }

  for (const file of ASSET_FILES) {
    const srcPath = path.join(ROOT, file);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(targetDir, file));
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
