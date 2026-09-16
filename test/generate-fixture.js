#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { validate, normalizeStructureIds } = require("./capture-messenger-fixture");

const STRUCTURE_PATH = path.resolve(__dirname, "fixtures/messenger-structure.json");
const MODEL_JSON_PATH = path.resolve(__dirname, "fixtures/generated-fixture-model.json");
const MODEL_JS_PATH = path.resolve(__dirname, "mock-messenger/generated-structure.js");

function extractModel(capturedData) {
  validate(capturedData);
  normalizeStructureIds(capturedData);

  const structures = capturedData.structures || [];

  function walk(node, visitor) {
    if (!node || typeof node !== "object") return;
    visitor(node);
    if (Array.isArray(node.children)) {
      node.children.forEach((c) => walk(c, visitor));
    }
  }

  // 1. Thread menu button semantics
  let threadMenuButtonModel = null;
  for (const s of structures) {
    walk(s, (n) => {
      const label = n.attrs?.["aria-label"] || "";
      if (/^More options for/i.test(label) && n.attrs?.role === "button") {
        if (!threadMenuButtonModel) {
          threadMenuButtonModel = {
            tag: n.tag || "div",
            role: n.attrs.role || "button",
            ariaHaspopup: n.attrs["aria-haspopup"] || "menu",
            ariaControls: n.attrs["aria-controls"] || "thread-list-menu-buttons",
            tabindex: n.attrs.tabindex || "0",
            labelPattern: "More options for {name}",
            dimensions: n.dimensions || { width: 40, height: 40 },
          };
        }
      }
    });
    if (threadMenuButtonModel) break;
  }

  // Fallback defaults if not explicitly captured
  if (!threadMenuButtonModel) {
    threadMenuButtonModel = {
      tag: "div",
      role: "button",
      ariaHaspopup: "menu",
      ariaControls: "thread-list-menu-buttons",
      tabindex: "0",
      labelPattern: "More options for {name}",
      dimensions: { width: 40, height: 40 },
    };
  }

  // 2. Marketplace Navigation
  let marketplaceNavModel = null;
  for (const s of structures) {
    walk(s, (n) => {
      if (n.attrs?.["aria-label"] === "Marketplace" && (n.attrs?.role === "link" || n.tag === "a")) {
        if (!marketplaceNavModel) {
          marketplaceNavModel = {
            tag: n.tag || "a",
            role: n.attrs.role || "link",
            ariaLabel: "Marketplace",
            dimensions: n.dimensions || { width: 112, height: 56 },
          };
        }
      }
    });
    if (marketplaceNavModel) break;
  }
  if (!marketplaceNavModel) {
    marketplaceNavModel = {
      tag: "a",
      role: "link",
      ariaLabel: "Marketplace",
      dimensions: { width: 112, height: 56 },
    };
  }

  // 3. Settings Button
  let settingsModel = null;
  for (const s of structures) {
    walk(s, (n) => {
      if (n.attrs?.["aria-label"] === "Settings, help and more") {
        if (!settingsModel) {
          settingsModel = {
            tag: n.tag || "div",
            role: n.attrs.role || "button",
            ariaLabel: "Settings, help and more",
            ariaControls: n.attrs["aria-controls"] || "mw-inbox-settings-menu",
            ariaHaspopup: n.attrs["aria-haspopup"] || "dialog",
          };
        }
      }
    });
    if (settingsModel) break;
  }
  if (!settingsModel) {
    settingsModel = {
      tag: "div",
      role: "button",
      ariaLabel: "Settings, help and more",
      ariaControls: "mw-inbox-settings-menu",
      ariaHaspopup: "dialog",
    };
  }

  // 4. Marketplace Header Banner Options
  let marketplaceBannerModel = null;
  for (const s of structures) {
    walk(s, (n) => {
      const label = n.attrs?.["aria-label"] || "";
      if (/^Conversation titled/i.test(label)) {
        marketplaceBannerModel = {
          dialogRole: n.attrs?.role || "dialog",
          ariaLabelPattern: "Conversation titled {name}",
          moreOptions: {
            role: "button",
            ariaLabel: "More options",
            ariaHaspopup: "dialog",
            dimensions: { width: 136, height: 36 },
          },
        };
      }
    });
    if (marketplaceBannerModel) break;
  }
  if (!marketplaceBannerModel) {
    marketplaceBannerModel = {
      dialogRole: "dialog",
      ariaLabelPattern: "Conversation titled {name}",
      moreOptions: {
        role: "button",
        ariaLabel: "More options",
        ariaHaspopup: "dialog",
        dimensions: { width: 136, height: 36 },
      },
    };
  }

  // 5. Menu semantics (from captured structures if available)
  let capturedMenu = null;
  for (const s of structures) {
    walk(s, (n) => {
      if (n.attrs?.role === "menu") {
        const itemLabels = [];
        walk(n, (child) => {
          if (child.attrs?.role === "menuitem" || child.attrs?.role === "menuitemradio") {
            const l = child.attrs?.["aria-label"] || child.text || "";
            if (l) itemLabels.push(l);
          }
        });
        if (itemLabels.length > 0) {
          capturedMenu = {
            menuRole: n.attrs.role,
            menuId: n.attrs.id || "thread-list-menu-buttons",
            itemRole: "menuitem",
            itemTag: "button",
            labels: {
              delete: itemLabels.find((l) => /delete/i.test(l)) || "Delete chat",
              archive: itemLabels.find((l) => /archive/i.test(l)) || "Archive",
              restore: itemLabels.find((l) => /restore|unarchive/i.test(l)) || "Restore",
            },
          };
        }
      }
    });
    if (capturedMenu) break;
  }
  const menuModel = capturedMenu || {
    menuRole: "menu",
    menuId: "thread-list-menu-buttons",
    itemRole: "menuitem",
    itemTag: "button",
    labels: {
      delete: "Delete chat",
      archive: "Archive",
      restore: "Restore",
    },
  };

  // 6. Dialog semantics (from captured structures if available)
  let capturedDialog = null;
  for (const s of structures) {
    walk(s, (n) => {
      if (n.attrs?.role === "dialog" || n.attrs?.role === "alertdialog") {
        const btnLabels = [];
        walk(n, (child) => {
          if (child.attrs?.role === "button" || child.tag === "button") {
            const l = child.attrs?.["aria-label"] || child.text || "";
            if (l) btnLabels.push(l);
          }
        });
        if (btnLabels.length > 0) {
          capturedDialog = {
            dialogRole: n.attrs.role || "dialog",
            labels: {
              confirmDelete: btnLabels.find((l) => /delete/i.test(l)) || "Delete chat",
              cancel: btnLabels.find((l) => /cancel/i.test(l)) || "Cancel",
              unrelatedAction: btnLabels.find((l) => /learn|help|info/i.test(l)) || "Learn more",
            },
          };
        }
      }
    });
    if (capturedDialog) break;
  }
  const dialogModel = capturedDialog || {
    dialogRole: "dialog",
    labels: {
      confirmDelete: "Delete chat",
      cancel: "Cancel",
      unrelatedAction: "Learn more",
    },
  };

  const contentHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(capturedData))
    .digest("hex");

  return {
    source: "messenger-structure.json",
    generatedFromHash: contentHash,
    threadMenuButton: threadMenuButtonModel,
    marketplaceNav: marketplaceNavModel,
    settingsButton: settingsModel,
    marketplaceBanner: marketplaceBannerModel,
    menu: menuModel,
    dialog: dialogModel,
  };
}

function generate() {
  if (!fs.existsSync(STRUCTURE_PATH)) {
    console.error(`Error: Source structure file not found at ${STRUCTURE_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(STRUCTURE_PATH, "utf8");
  const capturedData = JSON.parse(raw);

  const model = extractModel(capturedData);

  // Write JSON model
  fs.writeFileSync(MODEL_JSON_PATH, JSON.stringify(model, null, 2) + "\n", "utf8");
  console.log(`✅ Normalized fixture model written to ${MODEL_JSON_PATH}`);

  // Write JS model for mock consumption in browser
  const jsContent = `/* Auto-generated from test/fixtures/messenger-structure.json by test/generate-fixture.js */
(function (root) {
  "use strict";
  const model = ${JSON.stringify(model, null, 2)};
  if (typeof module === "object" && module.exports) {
    module.exports = model;
  } else {
    root.__GENERATED_FIXTURE_MODEL__ = model;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
`;

  fs.writeFileSync(MODEL_JS_PATH, jsContent, "utf8");
  console.log(`✅ Generated structure script written to ${MODEL_JS_PATH}`);

  return model;
}

if (require.main === module) {
  generate();
}

module.exports = { generate, extractModel };
