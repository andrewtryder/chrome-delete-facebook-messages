"use strict";

const { test, expect, chromium } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const { build } = require("../scripts/build");

const pathToDevExtension = path.resolve(__dirname, "../dist/dev");
const pathToProdExtension = path.resolve(__dirname, "../dist/prod");

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
    await page.goto("http://127.0.0.1:4173/");

    // Wait for content script to inject and set marker attribute on documentElement
    await page.waitForFunction(
      () => document.documentElement.getAttribute("data-fb-cleaner-injected") === "true",
      { timeout: 5000 },
    );

    const isInjected = await page.evaluate(
      () => document.documentElement.getAttribute("data-fb-cleaner-injected") === "true",
    );
    expect(isInjected).toBe(true);
    await page.close();
  });

  test("3. Popup recognizes active fixture tab", async () => {
    const fixturePage = await context.newPage();
    await fixturePage.goto("http://127.0.0.1:4173/");
    await fixturePage.waitForFunction(() => typeof window.MockMessenger !== "undefined");

    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    await popupPage.waitForFunction(() => {
      const scope = typeof angular !== "undefined" && angular.element(document.body).scope();
      return scope && scope.onFB === true;
    });

    const onFB = await popupPage.evaluate(() => {
      return angular.element(document.body).scope().onFB;
    });
    expect(onFB).toBe(true);

    await popupPage.close();
    await fixturePage.close();
  });

  test("4. Dry-run through popup changes nothing on the fixture", async () => {
    const fixturePage = await context.newPage();
    await fixturePage.goto("http://127.0.0.1:4173/");
    await fixturePage.waitForFunction(() => typeof window.MockMessenger !== "undefined");

    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    await popupPage.waitForFunction(() => {
      const scope = typeof angular !== "undefined" && angular.element(document.body).scope();
      return scope && scope.onFB === true;
    });

    // Enable dry-run mode in popup
    await popupPage.evaluate(() => {
      const scope = angular.element(document.body).scope();
      scope.$apply(() => {
        scope.dryRun = true;
      });
    });

    const initialDeleted = await fixturePage.evaluate(
      () => window.MockMessenger.state.deletedCount,
    );

    // Trigger delete from popup
    await popupPage.locator(".delete-messages-btn").first().click();

    // Wait for popup deleteProcess to be marked true
    await popupPage.waitForFunction(() => {
      const scope = angular.element(document.body).scope();
      return scope && scope.deleteProcess === true;
    });

    // Wait briefly for dry-run inspections to proceed
    await popupPage.waitForTimeout(2000);

    // Stop dry run via popup
    await popupPage.evaluate(() => {
      chrome.tabs.query({}, (tabs) => {
        const target = tabs.find((t) => t.url && t.url.includes("4173"));
        if (target) {
          chrome.tabs.sendMessage(target.id, { action: "stopAutomation" });
        }
      });
    });

    await popupPage.waitForTimeout(500);

    const finalDeleted = await fixturePage.evaluate(
      () => window.MockMessenger.state.deletedCount,
    );
    expect(finalDeleted).toBe(initialDeleted);

    await popupPage.close();
    await fixturePage.close();
  });

  test("5. One fake conversation can be deleted end-to-end via popup message", async () => {
    const fixturePage = await context.newPage();
    await fixturePage.goto("http://127.0.0.1:4173/");
    await fixturePage.waitForFunction(() => typeof window.MockMessenger !== "undefined");

    const initialCount = await fixturePage.evaluate(
      () => window.MockMessenger.state.inbox.length,
    );
    expect(initialCount).toBe(11);

    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    await popupPage.waitForFunction(() => {
      const scope = typeof angular !== "undefined" && angular.element(document.body).scope();
      return scope && scope.onFB === true;
    });

    // Ensure dry-run is disabled
    await popupPage.evaluate(() => {
      const scope = angular.element(document.body).scope();
      scope.$apply(() => {
        scope.dryRun = false;
      });
    });

    // Send delete with maxActions: 1 to delete exactly 1 conversation
    await popupPage.evaluate(() => {
      chrome.tabs.query({}, (tabs) => {
        const target = tabs.find((t) => t.url && t.url.includes("4173"));
        if (target) {
          chrome.tabs.sendMessage(target.id, {
            action: "deleteMsgs",
            maxActions: 1,
          });
        }
      });
    });

    await fixturePage.waitForFunction(
      () => window.MockMessenger.state.deletedCount === 1,
      { timeout: 12000 },
    );

    const remainingCount = await fixturePage.evaluate(
      () => window.MockMessenger.state.inbox.length,
    );
    expect(remainingCount).toBe(10);

    await popupPage.close();
    await fixturePage.close();
  });

  test("6. Stop propagates through actual runtime messaging and halts automation", async () => {
    const fixturePage = await context.newPage();
    await fixturePage.goto("http://127.0.0.1:4173/");
    await fixturePage.waitForFunction(() => typeof window.MockMessenger !== "undefined");

    const popupPage = await context.newPage();
    await popupPage.goto(
      `chrome-extension://${extensionId}/src/browser_action/browser_action.html`,
    );

    // Start a multi-action loop
    await popupPage.evaluate(() => {
      chrome.tabs.query({}, (tabs) => {
        const target = tabs.find((t) => t.url && t.url.includes("4173"));
        if (target) {
          chrome.tabs.sendMessage(target.id, {
            action: "deleteMsgs",
            maxActions: 5,
          });
        }
      });
    });

    await fixturePage.waitForFunction(
      () => window.MockMessenger.state.deletedCount >= 1,
      { timeout: 10000 },
    );

    // Dispatch stop from popup
    await popupPage.evaluate(() => {
      chrome.tabs.query({}, (tabs) => {
        const target = tabs.find((t) => t.url && t.url.includes("4173"));
        if (target) {
          chrome.tabs.sendMessage(target.id, { action: "stopAutomation" });
        }
      });
    });

    await popupPage.waitForTimeout(500);

    const countAfterStop = await fixturePage.evaluate(
      () => window.MockMessenger.state.deletedCount,
    );

    // Wait 1.5s to ensure no more deletes occur after stop
    await fixturePage.waitForTimeout(1500);

    const countLater = await fixturePage.evaluate(
      () => window.MockMessenger.state.deletedCount,
    );
    expect(countLater).toBe(countAfterStop);

    await popupPage.close();
    await fixturePage.close();
  });

  test("7. Production manifest strictly excludes localhost and untrusted origins", () => {
    const prodManifestPath = path.join(pathToProdExtension, "manifest.json");
    expect(fs.existsSync(prodManifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(prodManifestPath, "utf8"));
    const matches = manifest.content_scripts[0].matches;

    expect(matches).toContain("https://*.facebook.com/*");
    expect(matches).toContain("https://*.messenger.com/*");

    const forbidden = matches.filter(
      (m) => m.includes("localhost") || m.includes("127.0.0.1"),
    );
    expect(forbidden).toEqual([]);
  });
});
