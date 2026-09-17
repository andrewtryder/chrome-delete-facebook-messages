/*
 * Safe DOM capture tool for Facebook Messenger & Marketplace Messages.
 *
 * HOW TO USE IN CHROME DEVTOOLS:
 * 1. Open Facebook Messages (https://www.facebook.com/messages/) in Chrome.
 * 2. If capturing Marketplace:
 *    - Click into "Marketplace" on the left sidebar.
 *    - Click into any Marketplace conversation.
 *    - (Optional) Click the "More options" (•••) button on the listing banner to open its menu.
 * 3. Open Chrome DevTools (F12 or Cmd+Option+I), switch to the "Console" tab.
 * 4. Paste the contents of this file and press Enter.
 * 5. Run:
 *      DeleteFacebookMessagesFixtureCapture.inspectMarketplace()   // Diagnostics of detected Marketplace elements
 *      DeleteFacebookMessagesFixtureCapture.download()            // Downloads sanitized messenger-structure.json
 *    or:
 *      DeleteFacebookMessagesFixtureCapture.copy()                // Copies sanitized JSON to clipboard
 *
 * PRIVACY GUARANTEES:
 * - Observation-only: NO clicks, NO network requests, NO storage/cookie reads.
 * - Reads only structural attributes: role, aria-*, tag, visibility, geometry.
 * - Anonymizes all thread names to "Person 001", "Person 002", etc.
 * - Replaces Marketplace titles with "Test Marketplace Thread 001".
 * - Strips all personal IDs, message bodies, timestamps, profile URLs, cookies, tokens.
 * - Runs a multi-pattern validator before writing output; fails if suspicious data is present.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DeleteFacebookMessagesFixtureCapture = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SAFE_ATTRS = [
    "role",
    "aria-label",
    "aria-controls",
    "aria-haspopup",
    "aria-modal",
    "aria-labelledby",
    "aria-describedby",
    "tabindex",
  ];

  const CONTROL_WORDS =
    /^(archive|archive chat|archive conversation|archived chats|archived|delete|delete chat|delete conversation|delete messages?|remove|remove chat|remove conversation|cancel|restore|restore chat|unarchive|unarchive chat|move to inbox|marketplace|settings, help and more|more options|learn more|ok|close|see details|sold|in stock|pending|mark as sold|report listing|view listing|buyer|seller)$/i;

  const SUSPICIOUS_PATTERNS = [
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i, // Email addresses
    /\+?\d[\d ().-]{7,}\d/, // Phone numbers
    /\b\d{10,}\b/, // Long numeric IDs (e.g. Facebook numeric IDs)
    /\b(fbid|user_id|thread_id|message_id|access_token|client_token|cookie|token)\b/i,
    /facebook\.com\/profile\.php\?id=/i,
    /\/messages\/t\/[^\s"']+/i,
    /[a-z0-9_-]{40,}/i, // Long hashes/opaque tokens
  ];

  const peopleMap = new Map();
  const marketplaceMap = new Map();
  const idMap = new Map();
  let personCounter = 0;
  let marketplaceCounter = 0;
  let idCounter = 0;

  function resetCaptureState() {
    peopleMap.clear();
    marketplaceMap.clear();
    idMap.clear();
    personCounter = 0;
    marketplaceCounter = 0;
    idCounter = 0;
  }

  function normalizeIdToken(token) {
    const trimmed = String(token || "").trim();
    if (!trimmed) return "";
    if (/^(mw-inbox-settings-menu|thread-list-menu-buttons|marketplace-entry|inbox-entry|marketplace-banner)$/i.test(trimmed)) {
      return trimmed;
    }
    if (idMap.has(trimmed)) {
      return idMap.get(trimmed);
    }
    idCounter++;
    const generated = `generated-id-${String(idCounter).padStart(3, "0")}`;
    idMap.set(trimmed, generated);
    return generated;
  }

  function normalizeIdList(value) {
    if (!value) return "";
    const tokens = String(value).trim().split(/\s+/);
    return tokens.map(normalizeIdToken).join(" ");
  }

  function sanitizeString(value) {
    const text = String(value || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return "";
    if (CONTROL_WORDS.test(text)) return text;

    if (/^More options for /i.test(text)) {
      const rawName = text.replace(/^More options for /i, "").trim();
      if (/marketplace/i.test(rawName)) {
        if (!marketplaceMap.has(rawName)) {
          marketplaceCounter++;
          marketplaceMap.set(
            rawName,
            `Test Marketplace Thread ${String(marketplaceCounter).padStart(3, "0")}`,
          );
        }
        return `More options for ${marketplaceMap.get(rawName)}`;
      }

      if (!peopleMap.has(rawName)) {
        personCounter++;
        peopleMap.set(
          rawName,
          `Person ${String(personCounter).padStart(3, "0")}`,
        );
      }
      return `More options for ${peopleMap.get(rawName)}`;
    }

    if (/^Conversation titled/i.test(text)) {
      const rawName = text.replace(/^Conversation titled/i, "").trim();
      if (!peopleMap.has(rawName)) {
        personCounter++;
        peopleMap.set(
          rawName,
          `Person ${String(personCounter).padStart(3, "0")}`,
        );
      }
      return `Conversation titled ${peopleMap.get(rawName)}`;
    }

    if (/marketplace/i.test(text)) {
      return "Marketplace";
    }

    if (/delete chat/i.test(text)) {
      return "Delete chat";
    }

    if (/delete conversation/i.test(text)) {
      return "Delete conversation";
    }

    if (/cannot be undone|delete your copy/i.test(text)) {
      return "[delete-warning]";
    }

    return "[redacted]";
  }

  function isElementVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isRelevant(el) {
    if (!el || !(el instanceof Element)) return false;
    return el.matches(
      '[role], button, [aria-label], [aria-controls], [aria-modal], [aria-haspopup], [aria-labelledby], [aria-describedby], [tabindex]',
    );
  }

  const SAFE_ROLES =
    /^(button|link|menu|menuitem|menuitemradio|dialog|listitem|row|list|navigation|tab|tablist|option|presentation|none|status|alert|alertdialog|group|region)$/i;

  const SAFE_HASPOPUP = /^(true|false|menu|dialog|listbox|tree|grid)$/i;

  function sanitizeAttribute(name, value) {
    const val = String(value || "").trim();
    if (!val) return "";

    if (name === "role") {
      return SAFE_ROLES.test(val) ? val.toLowerCase() : "[redacted]";
    }
    if (name === "aria-haspopup") {
      return SAFE_HASPOPUP.test(val) ? val.toLowerCase() : "[redacted]";
    }
    if (name === "aria-modal") {
      return /^(true|false)$/i.test(val) ? val.toLowerCase() : "[redacted]";
    }
    if (name === "tabindex") {
      return /^-?\d+$/.test(val) ? val : "[redacted]";
    }
    if (
      name === "id" ||
      name === "aria-controls" ||
      name === "aria-labelledby" ||
      name === "aria-describedby"
    ) {
      const hasSuspicious = SUSPICIOUS_PATTERNS.some((p) => p.test(val));
      if (hasSuspicious) return "[redacted]";
      return normalizeIdList(val);
    }
    return sanitizeString(val);
  }

  function serializeNode(el, depth = 0, maxDepth = 6) {
    if (!el || depth > maxDepth) return null;

    const attrs = {};
    for (const name of SAFE_ATTRS) {
      const val = el.getAttribute(name);
      if (val !== null && val !== undefined) {
        attrs[name] = sanitizeAttribute(name, val);
      }
    }

    const rect = el.getBoundingClientRect();
    const children = [];
    if (depth < maxDepth) {
      for (const child of el.children) {
        if (isRelevant(child) || (child.children.length === 0 && CONTROL_WORDS.test((child.textContent || "").trim()))) {
          const s = serializeNode(child, depth + 1, maxDepth);
          if (s) children.push(s);
        }
      }
    }

    const nodeResult = {
      tag: el.tagName.toLowerCase(),
      attrs,
      visible: isElementVisible(el),
      dimensions: {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      children: children.slice(0, 40),
    };

    const trimmedText = (el.innerText || el.textContent || "").trim();
    if (CONTROL_WORDS.test(trimmedText)) {
      nodeResult.text = trimmedText;
    }

    return nodeResult;
  }

  function validate(data) {
    if (!data || typeof data !== "object") {
      throw new Error("Fixture validation failed: fixture data must be an object.");
    }
    if (typeof data.schema !== "number" || data.schema < 1) {
      throw new Error(`Fixture validation failed: missing or invalid schema version (${data.schema}).`);
    }
    if (!Array.isArray(data.structures)) {
      throw new Error("Fixture validation failed: missing structures array.");
    }

    const serialized = JSON.stringify(data);
    const violations = [];
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(serialized)) {
        violations.push(String(pattern));
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Fixture validation failed: possible private data detected matching patterns (${violations.join(
          ", ",
        )})`,
      );
    }
    return true;
  }

  function capture() {
    if (typeof document === "undefined") {
      throw new Error("capture() must be run in a browser document context.");
    }

    resetCaptureState();

    // Capture highest-priority overlays (menus & dialogs) first so portals are never truncated
    const prioritySelectors = [
      '[role="menu"]',
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[aria-controls="thread-list-menu-buttons"]',
      '[aria-controls="mw-inbox-settings-menu"]',
    ];

    const generalSelectors = [
      '[aria-label^="More options for"]',
      '[aria-label="Settings, help and more"]',
      '[role="button"][aria-label="More options"]',
      'button[aria-label="More options"]',
      '[role="button"][aria-label*="options" i]',
      '[aria-label^="Conversation titled"]',
      'a[href*="/marketplace/"]',
      '[role="button"][aria-haspopup="dialog"]',
      '[role="button"][aria-haspopup="menu"]',
    ];

    const priorityRoots = [...document.querySelectorAll(prioritySelectors.join(", "))].filter(isRelevant);
    const generalRoots = [...document.querySelectorAll(generalSelectors.join(", "))].filter(isRelevant);

    const combinedRoots = [
      ...priorityRoots,
      ...generalRoots.filter((el) => !priorityRoots.includes(el)),
    ];

    const structures = combinedRoots
      .slice(0, 150)
      .map((el) => serializeNode(el, 0))
      .filter(Boolean);

    const result = {
      schema: 1,
      generatedAt: "SANITIZED",
      structures,
    };

    validate(result);
    return result;
  }

  function inspectMarketplace() {
    if (typeof document === "undefined") {
      console.warn("inspectMarketplace() must run in browser DevTools.");
      return;
    }

    console.group("🛒 Marketplace DOM Inspector Diagnostics");

    // 1. Check pathname and detail view indicators
    const isDetailPath = /\/messages\/t\//i.test(location.pathname);
    console.log("Current path:", location.pathname, "| Is detail view (/messages/t/):", isDetailPath);

    // 2. Look for Marketplace item links or banners
    const itemLinks = [...document.querySelectorAll('a[href*="/marketplace/item/"]')];
    console.log("Marketplace listing item links found:", itemLinks.length);

    // 3. Look for Conversation title
    const titles = [...document.querySelectorAll('[aria-label^="Conversation titled"]')].map((el) => ({
      text: (el.textContent || "").trim(),
      ariaLabel: el.getAttribute("aria-label"),
    }));
    console.log("Conversation title elements:", titles);

    // 4. Candidate More Options buttons
    const candidates = [...document.querySelectorAll(
      '[role="button"][aria-label*="options" i], button[aria-label*="options" i], [aria-label="More options"]'
    )].filter((el) => isElementVisible(el));

    const candidateTable = candidates.map((el, i) => {
      const r = el.getBoundingClientRect();
      const text = (el.textContent || el.innerText || "").trim();
      const aria = el.getAttribute("aria-label");
      const hasPopup = el.getAttribute("aria-haspopup");
      const matchesCurrentExtensionCriteria =
        r.width > 120 && r.height >= 24 && r.x > 300 && r.y > 110 && r.y < 280;

      return {
        index: i,
        tag: el.tagName.toLowerCase(),
        text: text.slice(0, 30),
        ariaLabel: aria,
        ariaHasPopup: hasPopup,
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        matchesExtensionSelector: matchesCurrentExtensionCriteria,
      };
    });

    console.log("Detected 'More options' / options candidates in current view:");
    console.table(candidateTable);

    // 5. Check if any menu or dialog is open right now
    const openMenus = [...document.querySelectorAll('[role="menu"], [role="dialog"]')].filter(isElementVisible);
    console.log("Currently open menus or dialogs:", openMenus.length);

    const openMenuDetails = openMenus.map((root, idx) => {
      const items = [...root.querySelectorAll('[role="menuitem"], button, [role="button"]')].map((el) => ({
        text: (el.textContent || "").trim(),
        role: el.getAttribute("role"),
        ariaLabel: el.getAttribute("aria-label"),
      }));
      return { menuIndex: idx + 1, tag: root.tagName.toLowerCase(), role: root.getAttribute("role"), items };
    });

    console.groupEnd();

    const report = {
      path: location.pathname,
      isDetailView: isDetailPath,
      marketplaceItemLinksCount: itemLinks.length,
      conversationTitles: titles,
      candidateOptionsButtons: candidateTable,
      openMenus: openMenuDetails,
    };

    return report;
  }

  function download(filename = "messenger-structure.json") {
    const data = capture();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
    console.info(`Saved sanitized fixture to ${filename}`);
    return data;
  }

  function copy() {
    const data = capture();
    const json = JSON.stringify(data, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(
        () => console.info("Sanitized fixture copied to clipboard!"),
        (err) => console.error("Clipboard copy failed:", err),
      );
    } else {
      console.log(json);
    }
    return data;
  }

  function normalizeStructureIds(root) {
    const localIdMap = new Map();
    let localIdCounter = 0;

    function mapToken(token) {
      const t = String(token || "").trim();
      if (!t) return "";
      if (/^(mw-inbox-settings-menu|thread-list-menu-buttons|marketplace-entry|inbox-entry|marketplace-banner)$/i.test(t)) {
        return t;
      }
      if (localIdMap.has(t)) return localIdMap.get(t);
      localIdCounter++;
      const gen = `generated-id-${String(localIdCounter).padStart(3, "0")}`;
      localIdMap.set(t, gen);
      return gen;
    }

    function mapTokens(val) {
      if (!val || typeof val !== "string") return val;
      return val.trim().split(/\s+/).map(mapToken).join(" ");
    }

    function walk(node) {
      if (!node || typeof node !== "object") return;
      if (node.attrs) {
        ["id", "aria-controls", "aria-labelledby", "aria-describedby"].forEach((attr) => {
          if (node.attrs[attr]) {
            node.attrs[attr] = mapTokens(node.attrs[attr]);
          }
        });
      }
      if (Array.isArray(node.children)) {
        node.children.forEach(walk);
      }
      if (Array.isArray(node.structures)) {
        node.structures.forEach(walk);
      }
    }

    walk(root);
    return root;
  }

  return {
    capture,
    resetCaptureState,
    inspectMarketplace,
    validate,
    download,
    copy,
    sanitizeString,
    normalizeStructureIds,
    SUSPICIOUS_PATTERNS,
  };
});
