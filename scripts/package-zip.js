#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PROD_DIR = path.join(ROOT, "dist/prod");
const DIST_DIR = path.join(ROOT, "dist");
const MANIFEST_PATH = path.join(ROOT, "manifest.json");

function packageZip() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error("manifest.json not found!");
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const version = manifest.version;

  if (!fs.existsSync(PROD_DIR)) {
    console.log("dist/prod not found. Running build first...");
    execSync("node scripts/build.js", { cwd: ROOT, stdio: "inherit" });
  }

  const latestZipName = "chrome-delete-facebook-messages-latest.zip";
  const versionedZipName = `chrome-delete-facebook-messages-${version}.zip`;

  const latestZipPath = path.join(DIST_DIR, latestZipName);
  const versionedZipPath = path.join(DIST_DIR, versionedZipName);

  // Remove existing zips
  if (fs.existsSync(latestZipPath)) fs.unlinkSync(latestZipPath);
  if (fs.existsSync(versionedZipPath)) fs.unlinkSync(versionedZipPath);

  console.log(`📦 Packaging production extension archives...`);

  // Create zip from dist/prod
  execSync(`zip -r -q "${latestZipPath}" .`, { cwd: PROD_DIR });
  fs.copyFileSync(latestZipPath, versionedZipPath);

  const statLatest = fs.statSync(latestZipPath);
  const statVersioned = fs.statSync(versionedZipPath);

  console.log(`✅ Created dist/${latestZipName} (${(statLatest.size / 1024).toFixed(1)} KB)`);
  console.log(`✅ Created dist/${versionedZipName} (${(statVersioned.size / 1024).toFixed(1)} KB)`);
}

if (require.main === module) {
  packageZip();
}

module.exports = { packageZip };
