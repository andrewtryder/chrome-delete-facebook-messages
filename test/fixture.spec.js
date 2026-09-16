const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");

const SCRIPT_PATH = path.resolve(__dirname, "../js/script.js");
const scriptContent = fs.readFileSync(SCRIPT_PATH, "utf8");

// List of forbidden external domains to guard against
const FORBIDDEN_DOMAINS = [
  "facebook.com",
  "messenger.com",
  "fbcdn.net",
  "facebook.net",
];

test.beforeEach(async ({ context, page }) => {
  // Hard network and navigation guard: block and abort any attempt to touch Facebook domains
  await context.route("**/*", (route) => {
    const url = route.request().url();
    const isForbidden = FORBIDDEN_DOMAINS.some((domain) => url.includes(domain));
    if (isForbidden) {
      console.warn(`[SAFETY GUARD ACTIVATED] Blocked attempted network request to: ${url}`);
      route.abort("blockedbyclient");
    } else {
      route.continue();
    }
  });

  // Navigate to local fixture
  await page.goto("/test/mock-messenger/index.html");

  // Inject Chrome extension mock APIs into page before injecting content script
  await page.evaluate(() => {
    window._sentMessages = [];
    window._onMessageListeners = [];

    window.chrome = {
      runtime: {
        lastError: null,
        sendMessage(msg, cb) {
          window._sentMessages.push(msg);
          if (typeof cb === "function") cb({ ok: true });
        },
        onMessage: {
          addListener(fn) {
            window._onMessageListeners.push(fn);
          },
        },
      },
      storage: {
        local: {
          data: { speedLevel: "ultra", dryRun: false, trialsFast: 0 },
          get(keys, cb) {
            let res = {};
            if (Array.isArray(keys)) {
              keys.forEach((k) => {
                res[k] = this.data[k];
              });
            } else if (typeof keys === "string") {
              res[keys] = this.data[keys];
            } else {
              res = Object.assign({}, this.data);
            }
            if (typeof cb === "function") cb(res);
            return Promise.resolve(res);
          },
          set(items, cb) {
            Object.assign(this.data, items);
            if (typeof cb === "function") cb();
            return Promise.resolve();
          },
        },
      },
    };
  });

  // Inject the actual extension script
  await page.addScriptTag({ content: scriptContent });

  // Wait for extension debug hook to be available
  await page.waitForFunction(() => typeof window.FBChatsCleanerDebug !== "undefined");
});

// Helper to send messages to the injected content script
async function dispatchExtensionMessage(page, action, payload = {}) {
  return await page.evaluate(
    ({ action, payload }) => {
      return new Promise((resolve) => {
        const msg = Object.assign({ action }, payload);
        const listeners = window._onMessageListeners || [];
        let handled = false;
        for (const fn of listeners) {
          const ret = fn(msg, {}, (response) => {
            handled = true;
            resolve(response);
          });
          if (ret === true) {
            // async response
          }
        }
        if (!handled) {
          setTimeout(() => resolve({ ok: true }), 50);
        }
      });
    },
    { action, payload },
  );
}

// Helper to get captured extension runtime messages
async function getSentMessages(page) {
  return await page.evaluate(() => window._sentMessages || []);
}

test.describe("Phase 6 — Automated Messenger Fixture Test Suite", () => {
  test("1. Detect fake conversations", async ({ page }) => {
    const snapshot = await page.evaluate(() => window.FBChatsCleanerDebug.snapshot());
    expect(snapshot.threadMenuButtonCount).toBe(11);
    expect(snapshot.buttons.length).toBe(11);
    expect(snapshot.buttons[0].label).toContain("More options for Person 001");
  });

  test("2. Open correct More Options menu", async ({ page }) => {
    const firstMoreBtn = page.locator('div[role="button"][aria-label^="More options for"]').first();
    await firstMoreBtn.click();

    const menu = page.locator('#thread-list-menu-buttons[role="menu"]');
    await expect(menu).toBeVisible();

    const archiveItem = menu.locator('button[role="menuitem"]:has-text("Archive")');
    const deleteItem = menu.locator('button[role="menuitem"]:has-text("Delete chat")');
    await expect(archiveItem).toBeVisible();
    await expect(deleteItem).toBeVisible();
  });

  test("3. Delete exactly one fake conversation", async ({ page }) => {
    const initialCount = await page.evaluate(() => window.MockMessenger.state.inbox.length);
    expect(initialCount).toBe(11);

    await dispatchExtensionMessage(page, "deleteMsgs", { maxActions: 1 });

    // Wait until completion message is sent
    await page.waitForFunction(() =>
      window._sentMessages.some((m) => m.action === "noMessagesToDlt" || m.count === 1),
    );

    const finalCount = await page.evaluate(() => window.MockMessenger.state.inbox.length);
    expect(finalCount).toBe(10);

    const deletedCount = await page.evaluate(() => window.MockMessenger.state.deletedCount);
    expect(deletedCount).toBe(1);
  });

  test("4. Delete multiple fake conversations", async ({ page }) => {
    await dispatchExtensionMessage(page, "deleteMsgs", { maxActions: 3 });

    await page.waitForFunction(() =>
      window._sentMessages.some((m) => m.count >= 3),
    );

    const inboxCount = await page.evaluate(() => window.MockMessenger.state.inbox.length);
    expect(inboxCount).toBe(8);

    const deletedCount = await page.evaluate(() => window.MockMessenger.state.deletedCount);
    expect(deletedCount).toBe(3);
  });

  test("5. Archive one conversation", async ({ page }) => {
    const initialArchived = await page.evaluate(() => window.MockMessenger.state.archived.length);

    await dispatchExtensionMessage(page, "archiveMsgs", { maxActions: 1 });

    await page.waitForFunction(() =>
      window._sentMessages.some((m) => m.action === "archiveProgress" && m.count === 1),
    );

    const finalInbox = await page.evaluate(() => window.MockMessenger.state.inbox.length);
    const finalArchived = await page.evaluate(() => window.MockMessenger.state.archived.length);

    expect(finalInbox).toBe(10);
    expect(finalArchived).toBe(initialArchived + 1);
  });

  test("6. Archive multiple conversations", async ({ page }) => {
    const initialArchived = await page.evaluate(() => window.MockMessenger.state.archived.length);

    await dispatchExtensionMessage(page, "archiveMsgs", { maxActions: 3 });

    await page.waitForFunction(() =>
      window._sentMessages.some((m) => m.action === "archiveProgress" && m.count === 3),
    );

    const finalInbox = await page.evaluate(() => window.MockMessenger.state.inbox.length);
    const finalArchived = await page.evaluate(() => window.MockMessenger.state.archived.length);

    expect(finalInbox).toBe(8);
    expect(finalArchived).toBe(initialArchived + 3);
  });

  test("7. Open archived messages", async ({ page }) => {
    await dispatchExtensionMessage(page, "openArchivedMsgs");

    await page.waitForFunction(() =>
      window._sentMessages.some((m) => m.action === "loadedCompleteArchived"),
    );

    const activeView = await page.evaluate(() => window.MockMessenger.state.view);
    expect(activeView).toBe("archived");

    const statusText = await page.locator("#fixture-status").textContent();
    expect(statusText).toContain("Archived");
  });

  test("8. Unarchive messages", async ({ page }) => {
    // First open archived
    await dispatchExtensionMessage(page, "openArchivedMsgs");
    await page.waitForFunction(() => window.MockMessenger.state.view === "archived");

    const archivedCountBefore = await page.evaluate(() => window.MockMessenger.state.archived.length);
    const inboxCountBefore = await page.evaluate(() => window.MockMessenger.state.inbox.length);

    // Run unarchive
    await dispatchExtensionMessage(page, "unarchiveAll", { maxActions: 1 });

    await page.waitForFunction(() =>
      window._sentMessages.some((m) => m.action === "unarchiveProgress" && m.count === 1),
    );

    const archivedCountAfter = await page.evaluate(() => window.MockMessenger.state.archived.length);
    const inboxCountAfter = await page.evaluate(() => window.MockMessenger.state.inbox.length);

    expect(archivedCountAfter).toBe(archivedCountBefore - 1);
    expect(inboxCountAfter).toBe(inboxCountBefore + 1);
  });

  test("9. Stop an operation", async ({ page }) => {
    // Start deletion loop with multiple actions
    await dispatchExtensionMessage(page, "deleteMsgs", { maxActions: 5 });

    // Wait for first deletion
    await page.waitForFunction(() =>
      window._sentMessages.some((m) => m.count >= 1),
    );

    // Request stop
    await dispatchExtensionMessage(page, "stopAutomation");

    await page.waitForFunction(() =>
      window._sentMessages.some((m) => m.action === "automationStopped"),
    );

    const deleted = await page.evaluate(() => window.MockMessenger.state.deletedCount);
    // Should have stopped before doing all 5
    expect(deleted).toBeLessThan(5);
  });

  test("10. Handle missing menu item", async ({ page }) => {
    await page.evaluate(() => {
      window.MockMessenger.flags.missingDelete = true;
    });

    await dispatchExtensionMessage(page, "deleteMsgs", { maxActions: 1 });

    // Expect warning about missing menu item
    await page.waitForFunction(() =>
      window._sentMessages.some(
        (m) => m.action === "automationWarning" && m.reason === "menu_item_missing",
      ),
    );

    const deleted = await page.evaluate(() => window.MockMessenger.state.deletedCount);
    expect(deleted).toBe(0);
  });

  test("11. Handle missing confirmation", async ({ page }) => {
    await page.evaluate(() => {
      window.MockMessenger.flags.missingConfirm = true;
    });

    await dispatchExtensionMessage(page, "deleteMsgs", { maxActions: 1 });

    // Expect warning about missing confirm button
    await page.waitForFunction(() =>
      window._sentMessages.some(
        (m) => m.action === "automationWarning" && m.reason === "confirm_missing",
      ),
    );

    const deleted = await page.evaluate(() => window.MockMessenger.state.deletedCount);
    expect(deleted).toBe(0);
  });

  test("12. Handle a menu that fails to open", async ({ page }) => {
    await page.evaluate(() => {
      window.MockMessenger.flags.failOpen = true;
    });

    await dispatchExtensionMessage(page, "deleteMsgs", { maxActions: 1 });

    // Expect warning about menu not opening
    await page.waitForFunction(() =>
      window._sentMessages.some(
        (m) => m.action === "automationWarning" && m.reason === "menu_not_opened",
      ),
    );

    const deleted = await page.evaluate(() => window.MockMessenger.state.deletedCount);
    expect(deleted).toBe(0);
  });

  test("13. Duplicate conversation display names", async ({ page }) => {
    // Inbox starts with two "Person 002" entries
    const initialPersons = await page.evaluate(() =>
      window.MockMessenger.state.inbox.filter((t) => t.name === "Person 002").length,
    );
    expect(initialPersons).toBe(2);

    // Delete first entry ("Person 001")
    await dispatchExtensionMessage(page, "deleteMsgs", { maxActions: 1 });
    await page.waitForFunction(() => window.MockMessenger.state.deletedCount === 1);
    await page.waitForFunction(() => !window.FBChatsCleanerDebug.isBusy());

    // Next entry is the first "Person 002", delete it
    await dispatchExtensionMessage(page, "deleteMsgs", { maxActions: 1 });
    await page.waitForFunction(() => window.MockMessenger.state.deletedCount === 2);
    await page.waitForFunction(() => !window.FBChatsCleanerDebug.isBusy());

    // Now verify one "Person 002" remains
    const remainingPersons = await page.evaluate(() =>
      window.MockMessenger.state.inbox.filter((t) => t.name === "Person 002").length,
    );
    expect(remainingPersons).toBe(1);
  });

  test("14. Confirmation dialog contains unrelated buttons", async ({ page }) => {
    // Open a menu and click Delete chat manually to inspect the dialog
    const moreBtn = page.locator('div[role="button"][aria-label^="More options for"]').first();
    await moreBtn.click();

    const deleteMenuItem = page.locator('#thread-list-menu-buttons button[role="menuitem"]:has-text("Delete chat")');
    await deleteMenuItem.click();

    const dialog = page.locator('div[role="dialog"][aria-label="Delete chat"]');
    await expect(dialog).toBeVisible();

    // Check unrelated "Learn more" button exists alongside Cancel and Delete chat
    const learnMoreBtn = dialog.locator('button:has-text("Learn more")');
    const cancelBtn = dialog.locator('button:has-text("Cancel")');
    const confirmBtn = dialog.locator('button.danger:has-text("Delete chat")');

    await expect(learnMoreBtn).toBeVisible();
    await expect(cancelBtn).toBeVisible();
    await expect(confirmBtn).toBeVisible();

    // Clean up
    await cancelBtn.click();
    await expect(dialog).not.toBeVisible();
  });

  test("15. Ensure Cancel is never mistaken for Delete", async ({ page }) => {
    // Open menu and delete dialog
    const moreBtn = page.locator('div[role="button"][aria-label^="More options for"]').first();
    await moreBtn.click();

    const deleteMenuItem = page.locator('#thread-list-menu-buttons button[role="menuitem"]:has-text("Delete chat")');
    await deleteMenuItem.click();

    const dialog = page.locator('div[role="dialog"][aria-label="Delete chat"]');
    await expect(dialog).toBeVisible();

    // Click Cancel
    const cancelBtn = dialog.locator('button:has-text("Cancel")');
    await cancelBtn.click();

    await expect(dialog).not.toBeVisible();

    // Ensure zero deletions took place
    const deletedCount = await page.evaluate(() => window.MockMessenger.state.deletedCount);
    expect(deletedCount).toBe(0);

    const inboxCount = await page.evaluate(() => window.MockMessenger.state.inbox.length);
    expect(inboxCount).toBe(11);
  });

  test("16. Ensure one logical action causes only one logical click", async ({ page }) => {
    // Track click log length before action
    const clicksBefore = await page.evaluate(() => window.MockMessenger.clickLog.length);

    await dispatchExtensionMessage(page, "deleteMsgs", { maxActions: 1 });

    await page.waitForFunction(() => window.MockMessenger.state.deletedCount === 1);

    const clickLog = await page.evaluate(() => window.MockMessenger.clickLog);
    const newClicks = clickLog.slice(clicksBefore);

    // There should be clicks on the More options button, Delete menu item, and Delete chat confirm button.
    // Verify that the confirm button ('Delete chat') received exactly 1 click event.
    const confirmClicks = newClicks.filter(
      (c) => c.text === "Delete chat" && c.role === "button",
    );
    expect(confirmClicks.length).toBe(1);

    // Verify the menu item ('Delete chat') received exactly 1 click event
    const menuClicks = newClicks.filter(
      (c) => c.text === "Delete chat" && c.role === "menuitem",
    );
    expect(menuClicks.length).toBe(1);
  });

  test("17. Dry run changes zero fixture records", async ({ page }) => {
    const inboxBefore = await page.evaluate(() => window.MockMessenger.state.inbox.length);

    await dispatchExtensionMessage(page, "deleteMsgs", { dryRun: true, maxActions: 2 });

    // Wait for skipped dry run signal
    await page.waitForFunction(() =>
      window._sentMessages.some(
        (m) => m.action === "automationWarning" && m.reason === "dry_run_action_not_selected",
      ),
    );

    const inboxAfter = await page.evaluate(() => window.MockMessenger.state.inbox.length);
    const deletedCount = await page.evaluate(() => window.MockMessenger.state.deletedCount);

    expect(inboxAfter).toBe(inboxBefore);
    expect(deletedCount).toBe(0);
  });

  test("18. Processing count matches actual completed operations", async ({ page }) => {
    await dispatchExtensionMessage(page, "deleteMsgs", { maxActions: 2 });

    await page.waitForFunction(() =>
      window._sentMessages.some(
        (m) => m.action === "deleteProgress" && m.count === 2,
      ),
    );

    const stateCount = await page.evaluate(() => window.MockMessenger.state.deletedCount);
    expect(stateCount).toBe(2);

    const progressMessages = await page.evaluate(() =>
      window._sentMessages.filter((m) => m.action === "deleteProgress"),
    );
    expect(progressMessages.length).toBe(2);
    expect(progressMessages[1].count).toBe(2);
  });

  test("19. Marketplace fixture flow completes and stops cleanly", async ({ page }) => {
    // Open Marketplace messages folder
    await dispatchExtensionMessage(page, "BuySell");

    await page.waitForFunction(() =>
      window._sentMessages.some((m) => m.action === "loadedCompleteBuySell"),
    );

    const activeView = await page.evaluate(() => window.MockMessenger.state.view);
    expect(activeView).toBe("marketplace");

    // Banner should be visible
    const banner = page.locator("#marketplace-banner");
    await expect(banner).toBeVisible();

    // Perform Marketplace delete (natural run without manual action cap)
    await dispatchExtensionMessage(page, "deleteBuySell");

    await page.waitForFunction(() =>
      window._sentMessages.some((m) => m.action === "deleteBuySellProgress" && m.count === 1),
    );

    // Verify it cleanly completes and stops
    await page.waitForFunction(() =>
      window._sentMessages.some((m) => m.action === "noBuySellMsgs"),
    );
    await page.waitForFunction(() => !window.FBChatsCleanerDebug.isBusy());

    const marketplaceCount = await page.evaluate(() => window.MockMessenger.state.marketplace.length);
    expect(marketplaceCount).toBe(0);
    const finalDeleted = await page.evaluate(() => window.MockMessenger.state.deletedCount);
    expect(finalDeleted).toBe(1);
  });

  test("21. Switching between Marketplace and Regular delete flows independently", async ({ page }) => {
    // Start in Marketplace
    await dispatchExtensionMessage(page, "BuySell");
    await page.waitForFunction(() =>
      window._sentMessages.some((m) => m.action === "loadedCompleteBuySell"),
    );
    expect(await page.evaluate(() => window.MockMessenger.state.view)).toBe("marketplace");

    const initialMarketplaceLen = await page.evaluate(() => window.MockMessenger.state.marketplace.length);
    const initialInboxLen = await page.evaluate(() => window.MockMessenger.state.inbox.length);

    // Call Delete Regular Messages while sitting in Marketplace
    await dispatchExtensionMessage(page, "deleteMsgs", { maxActions: 1 });

    await page.waitForFunction(() =>
      window._sentMessages.some((m) => m.action === "deleteProgress" && m.count === 1),
    );
    await page.waitForFunction(() => !window.FBChatsCleanerDebug.isBusy());

    // Should have navigated back to inbox and deleted 1 regular thread without touching marketplace
    expect(await page.evaluate(() => window.MockMessenger.state.view)).toBe("inbox");
    expect(await page.evaluate(() => window.MockMessenger.state.inbox.length)).toBe(initialInboxLen - 1);
    expect(await page.evaluate(() => window.MockMessenger.state.marketplace.length)).toBe(initialMarketplaceLen);

    // Now call Delete Marketplace Messages while sitting in Inbox
    await dispatchExtensionMessage(page, "deleteBuySell", { maxActions: 1 });

    await page.waitForFunction(() =>
      window._sentMessages.some((m) => m.action === "deleteBuySellProgress" && m.count === 1),
    );
    await page.waitForFunction(() => !window.FBChatsCleanerDebug.isBusy());

    // Should have navigated to marketplace and deleted 1 marketplace thread
    expect(await page.evaluate(() => window.MockMessenger.state.view)).toBe("marketplace");
    expect(await page.evaluate(() => window.MockMessenger.state.marketplace.length)).toBe(0);
  });

  test("22. Verify no test ever navigates to facebook.com or messenger.com", async ({ context, page }) => {
    // 1. Verify that in-page fetch to Facebook domains is actively intercepted and blocked
    const fetchBlocked = await page.evaluate(async () => {
      try {
        await fetch("https://www.facebook.com/messages/");
        return false;
      } catch (_) {
        return true;
      }
    });
    expect(fetchBlocked).toBe(true);

    // 2. Verify that top-level navigation to Facebook domains is blocked by the network guard
    const testPage = await context.newPage();
    let navBlocked = false;
    try {
      await testPage.goto("https://www.facebook.com/messages/", { timeout: 3000 });
    } catch (err) {
      navBlocked = true;
      expect(err.message).toMatch(/ERR_BLOCKED_BY_CLIENT|blockedbyclient|blocked_by_client|failed to load/i);
    }
    expect(navBlocked).toBe(true);
    await testPage.close();
  });
});
