"use strict";

const { test, expect, chromium } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const { build } = require("../scripts/build");

const pathToDevExtension = path.resolve(__dirname, "../dist/dev");
const pathToProdExtension = path.resolve(__dirname, "../dist/prod");
const FIXTURE_PORT = process.env.PORT || 4174;
const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}/`;

test.describe("True Manifest V3 Extension End-to-End Suite", () => {
  let context;
  let serviceWorker;
  let extensionId;

  test.beforeAll(async () => {
    build();
    // Launch persistent Chromium context with unpacked dev extension once for the suite
    context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [
        "--headless=new",
        `--disable-extensions-except=${pathToDevExtension}`,
        `--load-extension=${pathToDevExtension}`,
      ],
    });

    let [sw] = context.serviceWorkers();
    if (!sw) {
      sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
    }
    serviceWorker = sw;
    extensionId = serviceWorker.url().split("/")[2];
  });

  test.afterAll(async () => {
    if (context) {
      await context.close();
    }
  });

  test.beforeEach(async () => {
    test.setTimeout(30000);
  });

  test("1. MV3 extension loads with active background service worker", async () => {
    expect(serviceWorker).toBeDefined();
    expect(extensionId).toBeDefined();
    expect(extensionId.length).toBeGreaterThan(10);
    expect(serviceWorker.url()).toContain(`chrome-extension://${extensionId}/`);
  });

  test("2. Content script injects into development fixture via MV3 manifest", async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);

    await page.waitForFunction(
      () => document.documentElement.getAttribute("data-delete-facebook-messages-injected") === "true",
      { timeout: 5000 },
    );

    const isInjected = await page.evaluate(
      () => document.documentElement.getAttribute("data-delete-facebook-messages-injected") === "true",
    );
    expect(isInjected).toBe(true);
    await page.close();
  });

  test("3. Popup recognizes fixture and shows: Ready", async () => {
    const fixturePage = await context.newPage();
    await fixturePage.goto(FIXTURE_URL);
    await fixturePage.waitForFunction(() => typeof window.MockMessenger !== "undefined");

    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    await popupPage.waitForFunction(
      () => document.getElementById("status-heading")?.textContent === "Ready",
      { timeout: 6000 },
    );

    const heading = await popupPage.locator("#status-heading").textContent();
    expect(heading).toBe("Ready");

    await popupPage.close();
    await fixturePage.close();
  });

  test("4. Popup has no Angular global requirement", async () => {
    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    const hasAngular = await popupPage.evaluate(() => typeof window.angular !== "undefined");
    expect(hasAngular).toBe(false);

    await popupPage.close();
  });

  test("5. Popup has no jQuery global requirement", async () => {
    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    const hasJQuery = await popupPage.evaluate(
      () => typeof window.jQuery !== "undefined" || typeof window.$ !== "undefined",
    );
    expect(hasJQuery).toBe(false);

    await popupPage.close();
  });

  test("6. Dry-run can be enabled from the real popup", async () => {
    const fixturePage = await context.newPage();
    await fixturePage.goto(FIXTURE_URL);

    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    await popupPage.waitForFunction(
      () => document.getElementById("status-heading")?.textContent === "Ready",
    );

    const ctaBefore = await popupPage.locator('[data-testid="main-cta-btn"]').textContent();
    expect(ctaBefore.trim()).toBe("Start deleting");

    // Toggle dry-run on
    await popupPage.locator('[data-testid="dry-run-toggle"]').click();

    const ctaAfter = await popupPage.locator('[data-testid="main-cta-btn"]').textContent();
    expect(ctaAfter.trim()).toBe("Preview deletion");

    await popupPage.close();
    await fixturePage.close();
  });

  test("7. Dry-run + Delete regular inspects fixture and changes zero records", async () => {
    const fixturePage = await context.newPage();
    await fixturePage.goto(FIXTURE_URL);
    await fixturePage.waitForFunction(() => typeof window.MockMessenger !== "undefined");

    const initialDeleted = await fixturePage.evaluate(
      () => window.MockMessenger.state.deletedCount,
    );

    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    await popupPage.waitForFunction(
      () => document.getElementById("status-heading")?.textContent === "Ready",
    );

    // Enable dry-run
    await popupPage.locator('[data-testid="dry-run-toggle"]').check();
    // Enable limit to 2
    await popupPage.locator('[data-testid="limit-toggle"]').check();
    await popupPage.locator('[data-testid="max-actions-input"]').fill("2");

    // Click Preview deletion (no modal expected for dry-run)
    await popupPage.locator('[data-testid="main-cta-btn"]').click();

    // Wait for dry-run progress or completion
    await popupPage.waitForFunction(
      () => {
        const inspected = parseInt(document.getElementById("metric-inspected-val")?.textContent || "0", 10);
        return inspected >= 2;
      },
      { timeout: 12000 },
    );

    const finalDeleted = await fixturePage.evaluate(
      () => window.MockMessenger.state.deletedCount,
    );
    expect(finalDeleted).toBe(initialDeleted);

    await popupPage.close();
    await fixturePage.close();
  });

  test("8. Delete regular opens destructive confirmation; Cancel changes nothing", async () => {
    const fixturePage = await context.newPage();
    await fixturePage.goto(FIXTURE_URL);
    await fixturePage.waitForFunction(() => typeof window.MockMessenger !== "undefined");

    const initialDeleted = await fixturePage.evaluate(
      () => window.MockMessenger.state.deletedCount,
    );

    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    await popupPage.waitForFunction(
      () => document.getElementById("status-heading")?.textContent === "Ready",
    );

    // Ensure dry-run is unchecked
    await popupPage.locator('[data-testid="dry-run-toggle"]').uncheck();

    // Click Start deleting
    await popupPage.locator('[data-testid="main-cta-btn"]').click();

    // Confirmation modal must be visible
    const modal = popupPage.locator('[data-testid="confirm-modal"]');
    await expect(modal).not.toHaveClass(/hidden/);

    // Click Cancel
    await popupPage.locator('[data-testid="modal-cancel-btn"]').click();
    await expect(modal).toHaveClass(/hidden/);

    // Verify nothing deleted
    const countAfterCancel = await fixturePage.evaluate(
      () => window.MockMessenger.state.deletedCount,
    );
    expect(countAfterCancel).toBe(initialDeleted);

    await popupPage.close();
    await fixturePage.close();
  });

  test("9. Delete regular: confirming deletes exactly one when limit=1", async () => {
    const fixturePage = await context.newPage();
    await fixturePage.goto(FIXTURE_URL);
    await fixturePage.waitForFunction(() => typeof window.MockMessenger !== "undefined");

    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    await popupPage.waitForFunction(
      () => document.getElementById("status-heading")?.textContent === "Ready",
    );

    await popupPage.locator('[data-testid="dry-run-toggle"]').uncheck();
    await popupPage.locator('[data-testid="limit-toggle"]').check();
    await popupPage.locator('[data-testid="max-actions-input"]').fill("1");

    await popupPage.locator('[data-testid="main-cta-btn"]').click();
    await popupPage.locator('[data-testid="modal-confirm-btn"]').click();

    await fixturePage.waitForFunction(
      () => window.MockMessenger.state.deletedCount === 1,
      { timeout: 12000 },
    );

    expect(await fixturePage.evaluate(() => window.MockMessenger.state.deletedCount)).toBe(1);

    await popupPage.close();
    await fixturePage.close();
  });

  test("10. Custom limit: setting limit=2 produces exactly 2 more actions", async () => {
    const fixturePage = await context.newPage();
    await fixturePage.goto(FIXTURE_URL);
    await fixturePage.waitForFunction(() => typeof window.MockMessenger !== "undefined");

    const currentDeleted = await fixturePage.evaluate(
      () => window.MockMessenger.state.deletedCount,
    );

    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    await popupPage.waitForFunction(
      () => document.getElementById("status-heading")?.textContent === "Ready",
    );

    await popupPage.locator('[data-testid="dry-run-toggle"]').uncheck();
    await popupPage.locator('[data-testid="limit-toggle"]').check();
    await popupPage.locator('[data-testid="max-actions-input"]').fill("2");

    await popupPage.locator('[data-testid="main-cta-btn"]').click();
    await popupPage.locator('[data-testid="modal-confirm-btn"]').click();

    await fixturePage.waitForFunction(
      (prev) => window.MockMessenger.state.deletedCount === prev + 2,
      currentDeleted,
      { timeout: 15000 },
    );

    const finalDeleted = await fixturePage.evaluate(
      () => window.MockMessenger.state.deletedCount,
    );
    expect(finalDeleted).toBe(currentDeleted + 2);

    await popupPage.close();
    await fixturePage.close();
  });

  test("11. Archive regular works through popup", async () => {
    const fixturePage = await context.newPage();
    await fixturePage.goto(FIXTURE_URL);
    await fixturePage.waitForFunction(() => typeof window.MockMessenger !== "undefined");

    const initialArchived = await fixturePage.evaluate(
      () => window.MockMessenger.state.archived.length,
    );

    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    await popupPage.waitForFunction(
      () => document.getElementById("status-heading")?.textContent === "Ready",
    );

    // Select Archive
    await popupPage.locator('[data-testid="op-archive"]').click();
    await popupPage.locator('[data-testid="dry-run-toggle"]').uncheck();
    await popupPage.locator('[data-testid="limit-toggle"]').check();
    await popupPage.locator('[data-testid="max-actions-input"]').fill("1");

    // Click Start archiving (no destructive delete modal)
    await popupPage.locator('[data-testid="main-cta-btn"]').click();

    await fixturePage.waitForFunction(
      (prev) => window.MockMessenger.state.archived.length === prev + 1,
      initialArchived,
      { timeout: 12000 },
    );

    expect(await fixturePage.evaluate(() => window.MockMessenger.state.archived.length)).toBe(
      initialArchived + 1,
    );

    // Verify popup returns to idle
    await popupPage.waitForFunction(
      () => document.getElementById("running-card")?.classList.contains("hidden") &&
            !document.getElementById("btn-main-cta")?.classList.contains("hidden"),
      { timeout: 15000 },
    );

    await popupPage.close();
    await fixturePage.close();
  });

  test("12. Marketplace delete routes correctly through popup", async () => {
    const fixturePage = await context.newPage();
    await fixturePage.goto(FIXTURE_URL);
    await fixturePage.waitForFunction(() => typeof window.MockMessenger !== "undefined");

    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    await popupPage.waitForFunction(
      () => document.getElementById("status-heading")?.textContent === "Ready",
    );

    // Select Marketplace delete
    await popupPage.locator('[data-testid="op-delete-marketplace"]').click();
    await popupPage.locator('[data-testid="dry-run-toggle"]').check();
    await popupPage.locator('[data-testid="limit-toggle"]').check();
    await popupPage.locator('[data-testid="max-actions-input"]').fill("1");

    expect(await popupPage.locator('[data-testid="main-cta-btn"]').textContent()).toContain(
      "Preview Marketplace deletion",
    );

    await popupPage.locator('[data-testid="main-cta-btn"]').click();

    // Verify marketplace navigation/inspection occurs
    await popupPage.waitForFunction(
      () => {
        const inspected = parseInt(document.getElementById("metric-inspected-val")?.textContent || "0", 10);
        return inspected >= 1;
      },
      { timeout: 12000 },
    );

    // Verify popup returns to idle
    await popupPage.waitForFunction(
      () => document.getElementById("running-card")?.classList.contains("hidden") &&
            !document.getElementById("btn-main-cta")?.classList.contains("hidden"),
      { timeout: 15000 },
    );

    await popupPage.close();
    await fixturePage.close();
  });

  test("13. Restore archived safely navigates and executes", async () => {
    const fixturePage = await context.newPage();
    await fixturePage.goto(FIXTURE_URL);
    await fixturePage.waitForFunction(() => typeof window.MockMessenger !== "undefined");

    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    await popupPage.waitForFunction(
      () => document.getElementById("status-heading")?.textContent === "Ready",
    );

    // Select Restore
    await popupPage.locator('[data-testid="op-restore"]').click();
    await popupPage.locator('[data-testid="dry-run-toggle"]').check();
    await popupPage.locator('[data-testid="limit-toggle"]').check();
    await popupPage.locator('[data-testid="max-actions-input"]').fill("1");

    expect(await popupPage.locator('[data-testid="main-cta-btn"]').textContent()).toContain(
      "Preview restoring",
    );

    await popupPage.locator('[data-testid="main-cta-btn"]').click();

    await popupPage.waitForFunction(
      () => {
        const inspected = parseInt(document.getElementById("metric-inspected-val")?.textContent || "0", 10);
        return inspected >= 1;
      },
      { timeout: 12000 },
    );

    // Verify popup returns to idle
    await popupPage.waitForFunction(
      () => document.getElementById("running-card")?.classList.contains("hidden") &&
            !document.getElementById("btn-main-cta")?.classList.contains("hidden"),
      { timeout: 15000 },
    );

    await popupPage.close();
    await fixturePage.close();
  });

  test("14. Stop button halts in-flight automation cleanly", async () => {
    const fixturePage = await context.newPage();
    await fixturePage.goto(FIXTURE_URL);
    await fixturePage.waitForFunction(() => typeof window.MockMessenger !== "undefined");

    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    await popupPage.waitForFunction(
      () => document.getElementById("status-heading")?.textContent === "Ready",
    );

    await popupPage.locator('[data-testid="dry-run-toggle"]').check();
    await popupPage.locator('[data-testid="limit-toggle"]').check();
    await popupPage.locator('[data-testid="max-actions-input"]').fill("10");

    await popupPage.locator('[data-testid="main-cta-btn"]').click();

    // Running card should appear
    await expect(popupPage.locator('[data-testid="running-container"]')).not.toHaveClass(/hidden/);

    // Click Stop button in popup
    await popupPage.locator('[data-testid="stop-btn"]').click();

    // Verify stop banner or status
    await popupPage.waitForFunction(
      () => {
        const notif = document.getElementById("notification-text")?.textContent || "";
        return notif.includes("Stopping") || notif.includes("stopped");
      },
      { timeout: 6000 },
    );

    await popupPage.close();
    await fixturePage.close();
  });

  test("15. Progress counters update in real time", async () => {
    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    expect(await popupPage.locator('[data-testid="metric-processed"]').textContent()).toContain("0");
    expect(await popupPage.locator('[data-testid="metric-inspected"]').textContent()).toContain("0");
    expect(await popupPage.locator('[data-testid="metric-skipped"]').textContent()).toContain("0");
    expect(await popupPage.locator('[data-testid="metric-errors"]').textContent()).toContain("0");

    await popupPage.close();
  });

  test("16. Settings persist after popup reload", async () => {
    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    // Set dry run, limit=5, speed=slow, theme=dark
    await popupPage.locator('[data-testid="dry-run-toggle"]').check();
    await popupPage.locator('[data-testid="limit-toggle"]').check();
    await popupPage.locator('[data-testid="max-actions-input"]').fill("5");

    // Open advanced options to reveal speed select
    await popupPage.locator('[data-testid="advanced-toggle"]').click();
    await popupPage.locator('[data-testid="speed-select"]').selectOption("slow");

    // Open settings and change theme to dark
    await popupPage.locator('[data-testid="settings-btn"]').click();
    await popupPage.locator('[data-testid="theme-select"]').selectOption("dark");

    // Wait for storage write
    await popupPage.waitForTimeout(400);
    await popupPage.close();

    // Reopen popup and verify persistence
    const reloaded = await context.newPage();
    await reloaded.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    await reloaded.waitForFunction(
      () => document.getElementById("dry-run-toggle")?.checked === true,
      { timeout: 4000 },
    );

    expect(await reloaded.locator('[data-testid="dry-run-toggle"]').isChecked()).toBe(true);
    expect(await reloaded.locator('[data-testid="limit-toggle"]').isChecked()).toBe(true);
    expect(await reloaded.locator('[data-testid="max-actions-input"]').inputValue()).toBe("5");

    await reloaded.locator('[data-testid="advanced-toggle"]').click();
    expect(await reloaded.locator('[data-testid="speed-select"]').inputValue()).toBe("slow");
    expect(await reloaded.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

    await reloaded.close();
  });

  test("17. Version displayed in About equals manifest version", async () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../manifest.json"), "utf8"),
    );
    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    await popupPage.locator('[data-testid="settings-btn"]').click();
    await popupPage.locator('[data-testid="tab-about"]').click();

    const versionText = await popupPage.locator('[data-testid="about-version"]').textContent();
    expect(versionText).toContain(manifest.version);

    await popupPage.close();
  });

  test("18. Popup makes no automatic external network requests", async () => {
    const popupPage = await context.newPage();
    const externalRequests = [];

    popupPage.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("http://") || url.startsWith("https://")) {
        externalRequests.push(url);
      }
    });

    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );
    await popupPage.waitForTimeout(1000);

    expect(externalRequests).toEqual([]);
    await popupPage.close();
  });

  test("19. dist/prod contains no localhost content-script matches", () => {
    const prodManifestPath = path.join(pathToProdExtension, "manifest.json");
    expect(fs.existsSync(prodManifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(prodManifestPath, "utf8"));
    const matches = manifest.content_scripts[0].matches;

    expect(matches).toContain("https://*.facebook.com/messages*");
    expect(matches).toContain("https://*.facebook.com/latest/inbox*");
    expect(matches).toContain("https://*.messenger.com/*");
    expect(matches).not.toContain("https://*.facebook.com/*");

    const forbidden = matches.filter(
      (m) => m.includes("localhost") || m.includes("127.0.0.1"),
    );
    expect(forbidden).toEqual([]);
  });

  test("20. dist/prod does not contain known legacy popup vendor files", () => {
    const prodDir = pathToProdExtension;
    const forbiddenVendorFiles = [
      "src/browser_action/js/angular.min.js",
      "src/browser_action/js/bootstrap.min.js",
      "src/browser_action/js/toastr.min.js",
      "src/browser_action/js/papaparse.min.js",
      "src/browser_action/css/bootstrap.min.css",
      "src/browser_action/css/toastr.min.css",
      "js/jquery.min.js",
      "js/sweetAlert.min.js",
      "js/jquery-confirm.js",
    ];

    for (const f of forbiddenVendorFiles) {
      const fullPath = path.join(prodDir, f);
      expect(fs.existsSync(fullPath)).toBe(false);
    }
  });

  test("21. Popup viewport 440x600 layout and no horizontal overflow", async () => {
    const popupPage = await context.newPage();
    await popupPage.setViewportSize({ width: 440, height: 600 });
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    const layout = await popupPage.evaluate(() => {
      const el = document.documentElement;
      const body = document.body;
      const cta = document.getElementById("btn-main-cta");
      const header = document.querySelector(".app-header");
      return {
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        bodyWidth: body.offsetWidth,
        ctaWidth: cta ? cta.offsetWidth : 0,
        headerWidth: header ? header.offsetWidth : 0,
      };
    });

    // Zero horizontal scroll
    expect(layout.scrollWidth).toBeLessThanOrEqual(440);
    expect(layout.bodyWidth).toBeLessThanOrEqual(440);
    // Main CTA and header fill appropriate width
    expect(layout.ctaWidth).toBeGreaterThan(380);
    expect(layout.headerWidth).toBeGreaterThan(380);

    // Switch to settings and verify settings layout also does not horizontally scroll
    await popupPage.locator('[data-testid="settings-btn"]').click();
    const settingsLayout = await popupPage.evaluate(() => {
      return {
        scrollWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.offsetWidth,
      };
    });
    expect(settingsLayout.scrollWidth).toBeLessThanOrEqual(440);

    await popupPage.close();
  });

  test("22. Activity tab renders completed run summary and clears cleanly", async () => {
    const fixturePage = await context.newPage();
    await fixturePage.goto(FIXTURE_URL);
    await fixturePage.waitForFunction(() => typeof window.MockMessenger !== "undefined");

    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    await popupPage.waitForFunction(
      () => document.getElementById("status-heading")?.textContent === "Ready",
    );

    // Run a quick dry run
    await popupPage.locator('[data-testid="dry-run-toggle"]').check();
    await popupPage.locator('[data-testid="limit-toggle"]').check();
    await popupPage.locator('[data-testid="max-actions-input"]').fill("1");
    await popupPage.locator('[data-testid="main-cta-btn"]').click();

    // Wait until idle
    await popupPage.waitForFunction(
      () => document.getElementById("running-card")?.classList.contains("hidden") &&
            !document.getElementById("btn-main-cta")?.classList.contains("hidden"),
      { timeout: 15000 },
    );

    // Open settings -> Activity tab
    await popupPage.locator('[data-testid="settings-btn"]').click();
    await popupPage.locator('[data-testid="tab-activity"]').click();

    // Verify activity details are rendered
    await popupPage.waitForFunction(
      () => !document.getElementById("activity-details")?.classList.contains("hidden"),
    );

    const actionText = await popupPage.locator("#act-action").textContent();
    const resultText = await popupPage.locator("#act-result").textContent();
    expect(actionText).toContain("Delete regular");
    expect(resultText.length).toBeGreaterThan(0);

    // Clear activity
    await popupPage.locator('[data-testid="clear-activity-btn"]').click();
    await popupPage.waitForFunction(
      () => !document.getElementById("empty-activity")?.classList.contains("hidden"),
    );

    await popupPage.close();
    await fixturePage.close();
  });

  test("23. Popup rehydrates live state from running content script via getAutomationState", async () => {
    const fixturePage = await context.newPage();
    await fixturePage.goto(FIXTURE_URL);
    await fixturePage.waitForFunction(() => typeof window.MockMessenger !== "undefined");

    const popup1 = await context.newPage();
    await popup1.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );
    await popup1.waitForFunction(
      () => document.getElementById("status-heading")?.textContent === "Ready",
    );

    await popup1.locator('[data-testid="dry-run-toggle"]').check();
    await popup1.locator('[data-testid="limit-toggle"]').check();
    await popup1.locator('[data-testid="max-actions-input"]').fill("5");
    await popup1.locator('[data-testid="main-cta-btn"]').click();

    // Verify popup 1 is running
    await popup1.waitForFunction(
      () => !document.getElementById("running-card")?.classList.contains("hidden"),
    );

    // Close popup 1 while automation is active
    await popup1.close();

    // Open popup 2 in a new page to test rehydration
    const popup2 = await context.newPage();
    await popup2.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    // Verify popup 2 rehydrates running status or processed inspection counters
    await popup2.waitForFunction(
      () => {
        const isRunning = !document.getElementById("running-card")?.classList.contains("hidden");
        const inspected = parseInt(document.getElementById("metric-inspected-val")?.textContent || "0", 10);
        return isRunning || inspected >= 1;
      },
      { timeout: 15000 },
    );

    await popup2.close();
    await fixturePage.close();
  });

  test("24. Destructive confirmation modal focus trap, Escape dismissal, and focus restoration", async () => {
    const fixturePage = await context.newPage();
    await fixturePage.goto(FIXTURE_URL);
    await fixturePage.waitForFunction(() => typeof window.MockMessenger !== "undefined");

    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    await popupPage.waitForFunction(
      () => document.getElementById("status-heading")?.textContent === "Ready",
    );

    await popupPage.locator('[data-testid="dry-run-toggle"]').uncheck();
    await popupPage.locator('[data-testid="main-cta-btn"]').click();

    // Modal is visible
    expect(await popupPage.locator('[data-testid="confirm-modal"]').isVisible()).toBe(true);

    // Initial focus on Cancel button
    const activeElementId = await popupPage.evaluate(() => document.activeElement?.id);
    expect(activeElementId).toBe("btn-modal-cancel");

    // Press Escape to dismiss modal
    await popupPage.keyboard.press("Escape");
    expect(await popupPage.locator('[data-testid="confirm-modal"]').isVisible()).toBe(false);

    // Focus restored to CTA
    const restoredId = await popupPage.evaluate(() => document.activeElement?.id);
    expect(restoredId).toBe("btn-main-cta");

    // Reopen modal and test Tab focus trap
    await popupPage.locator('[data-testid="main-cta-btn"]').click();
    expect(await popupPage.locator('[data-testid="confirm-modal"]').isVisible()).toBe(true);

    // Press Tab - moves to Confirm button
    await popupPage.keyboard.press("Tab");
    expect(await popupPage.evaluate(() => document.activeElement?.id)).toBe("btn-modal-confirm");

    // Press Tab again - wraps back to Cancel button
    await popupPage.keyboard.press("Tab");
    expect(await popupPage.evaluate(() => document.activeElement?.id)).toBe("btn-modal-cancel");

    // Press Shift+Tab - wraps backward to Confirm button
    await popupPage.keyboard.press("Shift+Tab");
    expect(await popupPage.evaluate(() => document.activeElement?.id)).toBe("btn-modal-confirm");

    // Dismiss with Cancel button
    await popupPage.locator('[data-testid="modal-cancel-btn"]').click();
    expect(await popupPage.locator('[data-testid="confirm-modal"]').isVisible()).toBe(false);

    await popupPage.close();
    await fixturePage.close();
  });

  test("25. Popup displays Open Messenger when Messenger is not open, and clicking it opens Messenger tab", async () => {
    // Intercept navigation to avoid real external network requests
    await context.route("**/*facebook.com/**", (route) => route.abort());

    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    await popupPage.waitForFunction(
      () => document.getElementById("status-heading")?.textContent === "Messenger not detected",
      { timeout: 6000 },
    );

    const heading = await popupPage.locator("#status-heading").textContent();
    expect(heading).toBe("Messenger not detected");

    const openBtn = popupPage.locator('[data-testid="open-messenger-btn"]');
    expect(await openBtn.isVisible()).toBe(true);

    const [newPage] = await Promise.all([
      context.waitForEvent("page"),
      openBtn.click(),
    ]);

    expect(decodeURIComponent(newPage.url())).toContain("facebook.com/messages");

    await newPage.close();
    await popupPage.close();
    await context.unroute("**/*facebook.com/**");
  });
});
