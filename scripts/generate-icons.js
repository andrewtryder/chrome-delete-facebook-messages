#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const SVG_PATH = path.join(ROOT, "src/browser_action/assets/logo.svg");
const ICONS_DIR = path.join(ROOT, "icons");

const SIZES = [16, 32, 48, 128, 256];

async function generateIcons() {
  if (!fs.existsSync(SVG_PATH)) {
    console.error(`Source SVG not found: ${SVG_PATH}`);
    process.exit(1);
  }

  if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
  }

  const svgContent = fs.readFileSync(SVG_PATH, "utf8");
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log("🎨 Generating extension icons from src/browser_action/assets/logo.svg...");

  for (const size of SIZES) {
    const resizedSvg = svgContent.replace(
      /width="48" height="48"/,
      `width="${size}" height="${size}"`,
    );

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent;}</style></head><body>${resizedSvg}</body></html>`;
    await page.setContent(html);
    await page.setViewportSize({ width: size, height: size });

    const svgElement = await page.locator("svg");
    const outPath = path.join(ICONS_DIR, `${size}.png`);

    await svgElement.screenshot({
      path: outPath,
      omitBackground: true,
    });

    const stat = fs.statSync(outPath);
    console.log(`  ✅ icons/${size}.png (${size}x${size}, ${stat.size} bytes)`);
  }

  await browser.close();
  console.log("🎉 All extension icons generated successfully.");
}

if (require.main === module) {
  generateIcons().catch((err) => {
    console.error("Failed to generate icons:", err);
    process.exit(1);
  });
}

module.exports = { generateIcons };
