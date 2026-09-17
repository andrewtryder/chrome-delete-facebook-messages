#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PROD_DIR = path.join(ROOT, "dist/prod");

// Denylist patterns: [label, regex]
const DENYLIST = [
  ["Zakir Khan", /Zakir\s+Khan/i],
  ["Engr.Prince", /Engr\.?Prince/i],
  ["Engr.ZA", /Engr\.?ZA/i],
  ["engrzakkh@gmail.com", /engrzakkh@gmail\.com/i],
  ["zakirkhan6269", /zakirkhan6269/i],
  ["xakir", /\bxakir\b/i],
  ["gumroad", /gumroad/i],
  ["Previous Extension ID (ihemghdjahjpbpdagihedhegcojhnbgc)", /ihemghdjahjpbpdagihedhegcojhnbgc/i],
  ["Delete Facebook Messages Fast", /Delete\s+Facebook\s+Messages\s+Fast/i],
  ["DFMF", /\bDFMF\b/],
  ["DATM", /\bDATM\b/],
  ["FBChats Cleaner", /FBChats\s+Cleaner/i],
  ["FBChatsCleanerDebug", /FBChatsCleanerDebug/],
  ["data-fb-cleaner", /data-fb-cleaner/],
  ["Buy Subscription", /Buy\s+Subscription/i],
  ["trialsFast", /trialsFast/],
  ["license_key", /license_key/],
];

const FORBIDDEN_FILE_PATTERNS = [
  /jquery/i,
  /sweetalert/i,
  /^font\//,
  /\/font\//,
  /^img\//,
  /\/img\//,
  /\.ttf$/i,
  /\.otf$/i,
  /600\s*\(\d+\)\.png/i,
  /orginal\.png/i,
  /angular/i,
  /bootstrap/i,
  /toastr/i,
  /papaparse/i,
  /^css\/style\.css$/,
];

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
]);

function getTrackedFiles() {
  try {
    const stdout = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" });
    return stdout.split("\n").map((f) => f.trim()).filter(Boolean);
  } catch (err) {
    console.error("Failed to run git ls-files:", err.message);
    process.exit(1);
  }
}

function getAllFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      getAllFiles(fullPath, fileList);
    } else {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

function checkContent(filePath, relativePath, issues) {
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return;

  // Don't scan this audit script itself against its own denylist strings
  if (relativePath === "scripts/check-legacy-references.js") return;

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const [label, regex] of DENYLIST) {
      if (regex.test(line)) {
        issues.push({
          file: relativePath,
          line: i + 1,
          term: label,
          snippet: line.trim().slice(0, 100),
        });
      }
    }
  }
}

function runAudit() {
  console.log("🔍 Running Legacy Origin & Identifier Audit...");
  const issues = [];
  const fileIssues = [];

  // 1. Audit tracked files in repository
  const trackedFiles = getTrackedFiles();

  for (const file of trackedFiles) {
    // Check forbidden file paths
    for (const pattern of FORBIDDEN_FILE_PATTERNS) {
      if (pattern.test(file)) {
        fileIssues.push(`Tracked forbidden legacy file found: ${file}`);
      }
    }

    const fullPath = path.join(ROOT, file);
    if (fs.existsSync(fullPath)) {
      checkContent(fullPath, file, issues);
    }
  }

  // 2. Audit dist/prod if built
  if (fs.existsSync(PROD_DIR)) {
    const prodFiles = getAllFiles(PROD_DIR);
    for (const fullPath of prodFiles) {
      const relPath = path.relative(ROOT, fullPath);

      for (const pattern of FORBIDDEN_FILE_PATTERNS) {
        if (pattern.test(relPath)) {
          fileIssues.push(`Forbidden file in dist/prod: ${relPath}`);
        }
      }

      checkContent(fullPath, relPath, issues);
    }

    // Check manifest.json in dist/prod specifically for update_url
    const prodManifestPath = path.join(PROD_DIR, "manifest.json");
    if (fs.existsSync(prodManifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(prodManifestPath, "utf8"));
      if (manifest.update_url) {
        issues.push({
          file: "dist/prod/manifest.json",
          line: 1,
          term: "manifest.update_url",
          snippet: `Found update_url: ${manifest.update_url}`,
        });
      }
    }
  }

  // Report results
  let failed = false;

  if (fileIssues.length > 0) {
    failed = true;
    console.error("\n❌ Forbidden legacy files detected:");
    fileIssues.forEach((issue) => console.error(`   - ${issue}`));
  }

  if (issues.length > 0) {
    failed = true;
    console.error("\n❌ Legacy identifiers/branding detected:");
    issues.forEach((iss) => {
      console.error(`   - ${iss.file}:${iss.line} [${iss.term}] -> "${iss.snippet}"`);
    });
  }

  if (failed) {
    console.error("\n💥 Audit failed: Legacy references or files must be resolved before submission.\n");
    process.exit(1);
  }

  console.log("✅ Zero legacy identifiers, obsolete URLs, or forbidden assets detected.");
}

if (require.main === module) {
  runAudit();
}

module.exports = { runAudit };
