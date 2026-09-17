"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  checkUrl,
  isExtensionUrl,
  getOperationRuntimeAction,
  getOperationName,
  getProcessedLabel,
  getCtaLabel,
  getRunningText,
  migrateTheme,
  validateMaxActions,
  sanitizeActivity,
  normalizePreferences,
} = require("../../src/browser_action/js/browser_action");

describe("Popup Unit Tests — Operation and Action Mapping", () => {
  test("maps operation choices to runtime content script actions", () => {
    assert.equal(getOperationRuntimeAction("delete"), "deleteMsgs");
    assert.equal(getOperationRuntimeAction("deleteBuySell"), "deleteBuySell");
    assert.equal(getOperationRuntimeAction("archive"), "archiveMsgs");
    assert.equal(getOperationRuntimeAction("unarchive"), "openArchivedMsgs");
  });

  test("provides human-readable operation names", () => {
    assert.equal(getOperationName("delete"), "Delete regular conversations");
    assert.equal(getOperationName("deleteBuySell"), "Delete Marketplace conversations");
    assert.equal(getOperationName("archive"), "Archive regular conversations");
    assert.equal(getOperationName("unarchive"), "Restore archived conversations");
  });

  test("provides operation-appropriate processed metric labels", () => {
    assert.equal(getProcessedLabel("delete"), "Deleted");
    assert.equal(getProcessedLabel("deleteBuySell"), "Deleted");
    assert.equal(getProcessedLabel("archive"), "Archived");
    assert.equal(getProcessedLabel("unarchive"), "Restored");
  });
});

describe("Popup Unit Tests — Dynamic CTA and Running Labels", () => {
  test("generates correct CTA copy when dry run is OFF", () => {
    assert.equal(getCtaLabel({ operation: "delete", dryRun: false }), "Start deleting");
    assert.equal(getCtaLabel({ operation: "deleteBuySell", dryRun: false }), "Start Marketplace deletion");
    assert.equal(getCtaLabel({ operation: "archive", dryRun: false }), "Start archiving");
    assert.equal(getCtaLabel({ operation: "unarchive", dryRun: false }), "Restore archived conversations");
  });

  test("generates preview CTA copy when dry run is ON", () => {
    assert.equal(getCtaLabel({ operation: "delete", dryRun: true }), "Preview deletion");
    assert.equal(getCtaLabel({ operation: "deleteBuySell", dryRun: true }), "Preview Marketplace deletion");
    assert.equal(getCtaLabel({ operation: "archive", dryRun: true }), "Preview archiving");
    assert.equal(getCtaLabel({ operation: "unarchive", dryRun: true }), "Preview restoring");
  });

  test("generates running status text", () => {
    assert.equal(getRunningText({ operation: "delete", dryRun: false }), "Deleting conversations…");
    assert.equal(getRunningText({ operation: "delete", dryRun: true }), "Previewing conversations…");
    assert.equal(getRunningText({ operation: "archive", dryRun: false }), "Archiving conversations…");
    assert.equal(getRunningText({ operation: "unarchive", dryRun: false }), "Restoring conversations…");
  });
});

describe("Popup Unit Tests — Theme Migration and Settings", () => {
  test("preserves explicit theme settings", () => {
    assert.equal(migrateTheme("light", false), "light");
    assert.equal(migrateTheme("dark", false), "dark");
    assert.equal(migrateTheme("system", false), "system");
  });

  test("migrates legacy darkMode boolean gracefully", () => {
    assert.equal(migrateTheme(undefined, true), "dark");
    assert.equal(migrateTheme(undefined, false), "system");
    assert.equal(migrateTheme(null, false), "system");
  });

  test("validates maxActions bounds strictly", () => {
    assert.equal(validateMaxActions(10), 10);
    assert.equal(validateMaxActions("25"), 25);
    assert.equal(validateMaxActions(0), 1);
    assert.equal(validateMaxActions(-5), 1);
    assert.equal(validateMaxActions("invalid"), 1);
    assert.equal(validateMaxActions(99999), 10000);
  });
});

describe("Popup Unit Tests — Aggregate Activity Sanitization", () => {
  test("sanitizes aggregate activity and strips any PII or unexpected fields", () => {
    const raw = {
      action: "Delete regular conversations",
      result: "Completed",
      processed: 5,
      inspected: 12,
      skipped: 2,
      errors: 0,
      timestamp: "2026-09-16, 12:00:00 PM",
      // Sensitive fields that MUST NEVER be persisted:
      threadName: "Alice Smith",
      threadId: "123456",
      messageText: "Hello there",
      url: "https://facebook.com/messages/t/123456",
    };

    const sanitized = sanitizeActivity(raw);
    assert.equal(sanitized.action, "Delete regular conversations");
    assert.equal(sanitized.processed, 5);
    assert.equal(sanitized.inspected, 12);
    assert.equal(sanitized.skipped, 2);
    assert.equal(sanitized.errors, 0);

    // Verify PII fields are completely absent
    assert.equal(sanitized.threadName, undefined);
    assert.equal(sanitized.threadId, undefined);
    assert.equal(sanitized.messageText, undefined);
    assert.equal(sanitized.url, undefined);
  });

  test("handles null or invalid activity cleanly", () => {
    assert.equal(sanitizeActivity(null), null);
    assert.equal(sanitizeActivity(undefined), null);
    assert.equal(sanitizeActivity("string"), null);
  });

  test("normalizes preferences with fallback defaults", () => {
    const emptyPrefs = normalizePreferences({});
    assert.equal(emptyPrefs.theme, "system");
    assert.equal(emptyPrefs.dryRun, false);
    assert.equal(emptyPrefs.limitEnabled, false);
    assert.equal(emptyPrefs.maxActions, 10);
    assert.equal(emptyPrefs.speedLevel, "fast");
    assert.equal(emptyPrefs.lastActivity, null);
  });

  test("initializes session controls directly from configured defaults", () => {
    const customDefaults = normalizePreferences({
      defaultDryRun: true,
      defaultLimitEnabled: true,
      defaultMaxActions: 42,
      defaultSpeedLevel: "ultra",
      // Legacy or stale main keys should not override explicit defaults
      dryRun: false,
      limitEnabled: false,
    });
    assert.equal(customDefaults.dryRun, true);
    assert.equal(customDefaults.limitEnabled, true);
    assert.equal(customDefaults.maxActions, 42);
    assert.equal(customDefaults.speedLevel, "ultra");
  });

  test("reads recentActivity fallback from content script when lastActivity is empty", () => {
    const stored = {
      recentActivity: {
        action: "Delete regular conversations",
        result: "Completed",
        processed: 3,
        inspected: 3,
        skipped: 0,
        errors: 0,
      },
    };
    const prefs = normalizePreferences(stored);
    assert.notEqual(prefs.lastActivity, null);
    assert.equal(prefs.lastActivity.processed, 3);
  });
});

describe("Popup Unit Tests — Mode to Operation Mapping", () => {
  const { mapModeToOperation } = require("../../src/browser_action/js/browser_action");

  test("maps runtime modes to popup operations", () => {
    assert.equal(mapModeToOperation("delete"), "delete");
    assert.equal(mapModeToOperation("archive"), "archive");
    assert.equal(mapModeToOperation("deleteBuySell"), "deleteBuySell");
    assert.equal(mapModeToOperation("unarchive"), "unarchive");
    assert.equal(mapModeToOperation("unknown"), "delete");
  });
});

describe("Popup Unit Tests — Zero Remote Resources Audit", () => {
  test("popup HTML contains zero remote script or link stylesheet tags", () => {
    const htmlPath = path.resolve(__dirname, "../../src/browser_action/browser_action.html");
    const html = fs.readFileSync(htmlPath, "utf8");

    // Match any remote <link> or <script> tags
    const remoteLinkMatch = html.match(/<link[^>]+href=["'](https?:)?\/\/[^"']+["']/i);
    const remoteScriptMatch = html.match(/<script[^>]+src=["'](https?:)?\/\/[^"']+["']/i);

    assert.equal(remoteLinkMatch, null, "Found remote stylesheet link in popup HTML");
    assert.equal(remoteScriptMatch, null, "Found remote script tag in popup HTML");
  });
});

describe("Popup Unit Tests — Extension and Internal URL Detection", () => {
  test("identifies extension and browser internal URLs correctly", () => {
    assert.equal(isExtensionUrl("chrome-extension://abc123xyz/src/browser_action/browser_action.html"), true);
    assert.equal(isExtensionUrl("moz-extension://abc123xyz/popup.html"), true);
    assert.equal(isExtensionUrl("chrome://newtab/"), true);
    assert.equal(isExtensionUrl("about:blank"), true);
    assert.equal(isExtensionUrl("edge://extensions/"), true);
    assert.equal(isExtensionUrl("brave://settings/"), true);
    assert.equal(isExtensionUrl(""), true);
    assert.equal(isExtensionUrl(undefined), true);
    assert.equal(isExtensionUrl(null), true);
  });

  test("rejects regular web URLs as non-extension URLs", () => {
    assert.equal(isExtensionUrl("https://www.facebook.com/messages/"), false);
    assert.equal(isExtensionUrl("https://www.messenger.com/"), false);
    assert.equal(isExtensionUrl("https://www.google.com/"), false);
    assert.equal(isExtensionUrl("http://127.0.0.1:4173/"), false);
    assert.equal(isExtensionUrl("http://localhost:3000/"), false);
  });
});
