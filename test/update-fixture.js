#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { validate, SUSPICIOUS_PATTERNS } = require("./capture-messenger-fixture");

const defaultInput = path.resolve(__dirname, "fixtures/messenger-structure.json");
const targetFile = defaultInput;

const inputFile = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : defaultInput;

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

try {
  const content = fs.readFileSync(inputFile, "utf8");
  const parsed = JSON.parse(content);

  validate(parsed);
  console.log("✅ Privacy validation passed: No sensitive patterns detected.");

  if (inputFile !== targetFile) {
    fs.writeFileSync(targetFile, JSON.stringify(parsed, null, 2) + "\n", "utf8");
    console.log(`✅ Updated fixture written to ${targetFile}`);
  } else {
    console.log(`✅ Existing fixture ${targetFile} is valid and privacy-safe.`);
  }
} catch (err) {
  console.error("❌ Privacy validation error:", err.message);
  process.exit(1);
}
