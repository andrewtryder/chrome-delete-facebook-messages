"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { extractModel } = require("../generate-fixture");

describe("Fixture Generator Unit Tests", () => {
  const sampleCapturedData = {
    schema: 1,
    structures: [
      {
        tag: "div",
        attrs: {
          role: "button",
          "aria-label": "More options for Person 001",
          "aria-controls": "thread-list-menu-buttons",
          "aria-haspopup": "menu",
          tabindex: "0",
        },
        children: [],
      },
      {
        tag: "a",
        attrs: {
          role: "link",
          "aria-label": "Marketplace",
        },
        children: [],
      },
      {
        tag: "div",
        attrs: {
          role: "button",
          "aria-label": "Settings, help and more",
          "aria-controls": "mw-inbox-settings-menu",
          "aria-haspopup": "dialog",
        },
        children: [],
      },
      {
        tag: "div",
        attrs: {
          role: "menu",
          id: "thread-list-menu-buttons",
        },
        children: [
          {
            tag: "button",
            attrs: {
              role: "menuitem",
              "aria-label": "Delete chat",
            },
            children: [],
          },
          {
            tag: "button",
            attrs: {
              role: "menuitem",
              "aria-label": "Archive",
            },
            children: [],
          },
        ],
      },
      {
        tag: "div",
        attrs: {
          role: "dialog",
        },
        children: [
          {
            tag: "button",
            attrs: {
              role: "button",
              "aria-label": "Delete chat",
            },
            children: [],
          },
          {
            tag: "button",
            attrs: {
              role: "button",
              "aria-label": "Cancel",
            },
            children: [],
          },
        ],
      },
    ],
  };

  test("extractModel derives semantic models accurately", () => {
    const model = extractModel(sampleCapturedData);

    assert.equal(model.threadMenuButton.role, "button");
    assert.equal(model.threadMenuButton.labelPattern, "More options for {name}");
    assert.equal(model.marketplaceNav.ariaLabel, "Marketplace");
    assert.equal(model.settingsButton.ariaLabel, "Settings, help and more");
    assert.equal(model.menu.labels.delete, "Delete chat");
    assert.equal(model.menu.labels.archive, "Archive");
    assert.equal(model.dialog.labels.confirmDelete, "Delete chat");
    assert.equal(model.dialog.labels.cancel, "Cancel");
  });

  test("extractModel generates deterministic SHA-256 hash", () => {
    const model1 = extractModel(sampleCapturedData);
    const model2 = extractModel(sampleCapturedData);
    assert.equal(model1.generatedFromHash, model2.generatedFromHash);
    assert.match(model1.generatedFromHash, /^[a-f0-9]{64}$/);
  });

  test("extractModel produces fallback defaults when semantics are absent", () => {
    const emptyData = { schema: 1, structures: [] };
    const model = extractModel(emptyData);

    assert.equal(model.threadMenuButton.role, "button");
    assert.equal(model.menu.menuRole, "menu");
    assert.equal(model.dialog.dialogRole, "dialog");
    assert.equal(model.dialog.labels.cancel, "Cancel");
  });
});
