if (
  typeof document !== "undefined" &&
  document.documentElement &&
  document.documentElement.dataset.deleteFacebookMessagesFixture === "true"
) {
  document.documentElement.setAttribute(
    "data-delete-facebook-messages-injected",
    "true",
  );
}

(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Runtime state
  // ---------------------------------------------------------------------------
  let processedCount = 0;
  let dryRunInspectedCount = 0;
  let shouldRun = false;
  let busy = false;
  let activeMode = null;
  let actionDelaySeconds = 5;
  let dryRunActive = false;
  let maxActions = Infinity;
  let activeSkippedCount = 0;
  let activeErrorCount = 0;

  const SPEED_SECONDS = {
    slow: 18.0,
    normal: 10.0,
    fast: 5.0,
    veryfast: 2.5,
    ultra: 1.2,
  };

  const SELECTORS = {
    // Confirmed from your DevTools output on facebook.com/messages/e2ee/t/...
    threadMenuButton:
      'div[role="button"][aria-label^="More options for"][aria-controls="thread-list-menu-buttons"][aria-haspopup="menu"]',

    threadMenuButtonFallback:
      '[role="button"][aria-label^="More options for"], [role="button"][aria-controls="thread-list-menu-buttons"][aria-haspopup="menu"]',

    settingsButton:
      '[role="button"][aria-label="Settings, help and more"], [role="button"][aria-controls="mw-inbox-settings-menu"][aria-haspopup="menu"]',

    menuRoot:
      '[role="menu"], [id="thread-list-menu-buttons"], [id="mw-inbox-settings-menu"], [role="dialog"]',

    menuItem:
      '[role="menuitem"], [role="menuitemradio"], [role="option"], div[role="button"], button, a[role="link"], a[href]',

    dialog: '[role="dialog"]',

    dialogButton:
      '[role="dialog"] [role="button"], [role="dialog"] button, [role="dialog"] a[role="link"]',

    confirmButtonCandidate: 'button, [role="button"], [aria-label]',

    marketplaceCandidate:
      '[role="button"], [role="row"], [role="listitem"], a[href], div[aria-label]',
  };

  const ACTIONS = {
    delete: {
      startedAction: "deleteStarted",
      progressAction: "deleteProgress",
      completeAction: "noMessagesToDlt",
      errorAction: "deleteError",
      label: "Delete",
      popupLabel: "Delete",
      menuRegex:
        /^(delete|delete chat|delete conversation|remove|remove chat|remove conversation)$/i,
      looseMenuRegex: /\b(delete|remove)\b/i,
      confirmRegex:
        /^(delete|delete chat|delete conversation|delete messages?|remove)$/i,
      requiresConfirm: true,
      emptyMessage: "No Messages Found / All Deleted Successfully",
    },
    archive: {
      startedAction: "archiveStarted",
      progressAction: "archiveProgress",
      completeAction: "NoMsgsToArchv",
      errorAction: "archiveError",
      label: "Archive",
      popupLabel: "Archive",
      menuRegex: /^(archive|archive chat|archive conversation)$/i,
      looseMenuRegex: /\barchive\b/i,
      confirmRegex: null,
      requiresConfirm: false,
      emptyMessage: "No Messages Found / All Archived Successfully",
    },
    deleteBuySell: {
      startedAction: "deleteBuySellStarted",
      progressAction: "deleteBuySellProgress",
      completeAction: "noBuySellMsgs",
      errorAction: "deleteBuySellError",
      label: "Delete Buy/Sell",
      popupLabel: "Delete Buy/Sell",
      menuRegex:
        /^(delete|delete chat|delete conversation|remove|remove chat|remove conversation)$/i,
      looseMenuRegex: /\b(delete|remove)\b/i,
      confirmRegex:
        /^(delete|delete chat|delete conversation|delete messages?|remove)$/i,
      requiresConfirm: true,
      emptyMessage: "No Buy/Sell Messages / All Deleted",
    },
    unarchive: {
      startedAction: "unarchiveStarted",
      progressAction: "unarchiveProgress",
      completeAction: "noArchivedMsgs",
      errorAction: "unarchiveError",
      label: "Unarchive",
      popupLabel: "Unarchive",
      menuRegex:
        /^(unarchive|unarchive chat|unarchive conversation|move to inbox|restore|restore chat)$/i,
      looseMenuRegex: /\b(unarchive|move to inbox|restore)\b/i,
      confirmRegex: null,
      requiresConfirm: false,
      emptyMessage: "No Archived Messages / All Unarchived",
    },
  };

  // ---------------------------------------------------------------------------
  // Generic helpers
  // ---------------------------------------------------------------------------
  function send(action, payload = {}) {
    try {
      chrome.runtime.sendMessage({ action, ...payload }, () => {
        // Ignore "receiving end does not exist" when popup is closed.
        void chrome.runtime.lastError;
      });
    } catch (err) {
      console.debug("Unable to send runtime message:", action, err);
    }
  }

  function formatNumber(value) {
    if (value < 1000) return String(value);
    const tier = Math.floor(Math.log10(value) / 3);
    return (
      (value / Math.pow(1000, tier)).toFixed(1) + ["K", "M", "B"][tier - 1]
    );
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitFor(fn, timeoutMs = 5000, intervalMs = 100) {
    const end = Date.now() + timeoutMs;

    while (Date.now() < end) {
      const result = fn();
      if (result) return result;
      await sleep(intervalMs);
    }

    return null;
  }

  function getSpeedSeconds(speedLevel) {
    return SPEED_SECONDS[speedLevel || "fast"] || SPEED_SECONDS.fast;
  }

  async function loadSpeed() {
    try {
      const stored = await chrome.storage.local.get(["speedLevel"]);
      actionDelaySeconds = getSpeedSeconds(stored.speedLevel);
    } catch (err) {
      actionDelaySeconds = SPEED_SECONDS.fast;
    }
  }

  function isFixturePage() {
    return (
      typeof document !== "undefined" &&
      Boolean(
        document.documentElement &&
          document.documentElement.dataset.deleteFacebookMessagesFixture === "true",
      )
    );
  }

  function logDiagnostic(...args) {
    if (isFixturePage()) {
      console.log(...args);
    }
  }

  function warnDiagnostic(...args) {
    if (isFixturePage()) {
      console.warn(...args);
    }
  }

  async function actionDelay() {
    // The fixture is an explicitly marked local test target; no real-site
    // timing assumptions are needed there.
    if (isFixturePage()) {
      await sleep(20);
      return;
    }
    const baseMs = Math.max(250, actionDelaySeconds * 1000);
    const jitterMs = Math.floor(350 + Math.random() * 900);
    const totalMs = baseMs + jitterMs;
    await sleep(totalMs);
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (
      style.visibility === "hidden" ||
      style.display === "none" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function textVariants(el) {
    if (!el) return [];

    return [
      el.innerText,
      el.textContent,
      el.getAttribute && el.getAttribute("aria-label"),
      el.getAttribute && el.getAttribute("title"),
    ]
      .map(cleanText)
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);
  }

  function normalizedText(el) {
    return textVariants(el).join(" ").replace(/\s+/g, " ").trim();
  }

  function ownAccessibleText(el) {
    if (!el) return "";

    const aria = cleanText(el.getAttribute && el.getAttribute("aria-label"));
    if (aria) return aria;

    const title = cleanText(el.getAttribute && el.getAttribute("title"));
    if (title) return title;

    return cleanText(el.innerText || el.textContent);
  }

  function textMatches(el, regex) {
    return (
      textVariants(el).some((text) => regex.test(text)) ||
      regex.test(normalizedText(el))
    );
  }

  function queryAll(selector, root = document) {
    try {
      return [...root.querySelectorAll(selector)];
    } catch (err) {
      console.warn("Bad selector:", selector, err);
      return [];
    }
  }

  function visibleElements(selector, root = document) {
    return queryAll(selector, root).filter(isVisible);
  }

  function findVisible(selector, root = document) {
    return visibleElements(selector, root)[0] || null;
  }

  function findVisibleByText(selector, regex, root = document) {
    return (
      visibleElements(selector, root).find((el) => textMatches(el, regex)) ||
      null
    );
  }

  function closestClickable(el) {
    if (!el) return null;
    return (
      el.closest(
        '[role="menuitem"], [role="button"], button, a[href], [tabindex]',
      ) || el
    );
  }

  function centerPoint(el) {
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  function dispatchMouse(el, type) {
    const point = centerPoint(el);

    el.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: point.x,
        clientY: point.y,
        buttons: type === "mousedown" ? 1 : 0,
      }),
    );
  }

  function dispatchPointer(el, type) {
    if (typeof PointerEvent !== "function") return;

    const point = centerPoint(el);
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        clientX: point.x,
        clientY: point.y,
        buttons: type === "pointerdown" ? 1 : 0,
      }),
    );
  }

  function activate(rawEl) {
    const el = closestClickable(rawEl);
    if (!el) return false;

    try {
      el.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });
    } catch (_) {
      el.scrollIntoView({ block: "center", inline: "center" });
    }

    try {
      if (typeof el.focus === "function") el.focus({ preventScroll: true });
    } catch (_) {
      try {
        if (typeof el.focus === "function") el.focus();
      } catch (__) {}
    }

    // Direct click is the safest single-action invocation for React & native DOM
    // without semantic double-action risks from synthesized pointerup sequences.
    if (typeof el.click === "function") {
      el.click();
      return true;
    }

    return false;
  }

  const realClick = activate;

  function pressEnterOn(rawEl) {
    const el = closestClickable(rawEl);
    if (!el) return false;

    try {
      if (typeof el.focus === "function") el.focus({ preventScroll: true });
    } catch (_) {}

    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    el.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    return true;
  }

  function pressEscape() {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
      }),
    );
  }

  function showStatus(message) {
    let popup = document.getElementById("customDeletionPopup");

    if (!popup) {
      popup = document.createElement("div");
      popup.id = "customDeletionPopup";
      popup.style.cssText = [
        "position: fixed",
        "bottom: 20px",
        "left: 50%",
        "transform: translateX(-50%)",
        "width: 90%",
        "max-width: 1000px",
        "background: linear-gradient(135deg, #2980b9, #8e44ad)",
        "padding: 15px 20px",
        "display: flex",
        "align-items: center",
        "justify-content: space-between",
        "gap: 12px",
        "color: #fff",
        "font-size: 18px",
        "font-weight: bold",
        "box-shadow: 0 -4px 10px rgba(0,0,0,.3)",
        "z-index: 2147483647",
        "font-family: Arial, sans-serif",
        "border-radius: 12px",
      ].join("; ");

      const title = document.createElement("div");
      title.textContent = "Delete Facebook Messages";
      title.style.cssText =
        "display:flex;align-items:center;font-size:16px;font-weight:normal;gap:8px;white-space:nowrap";

      const body = document.createElement("div");
      body.className = "popup-message";
      body.style.cssText =
        "flex-grow:1;text-align:center;font-size:20px;font-weight:500";

      const stop = document.createElement("button");
      stop.id = "stopDeletionButton";
      stop.textContent = "Stop";
      stop.style.cssText = [
        "background:#ff4757",
        "border:none",
        "padding:10px 20px",
        "font-size:16px",
        "font-weight:bold",
        "color:white",
        "border-radius:8px",
        "cursor:pointer",
        "box-shadow:0 4px 10px rgba(0,0,0,.2)",
      ].join("; ");
      stop.addEventListener("click", stopAutomation);

      popup.append(title, body, stop);
      document.body.appendChild(popup);
    }

    const body = popup.querySelector(".popup-message");
    if (body) body.textContent = message;
  }

  function hideStatus() {
    const popup = document.getElementById("customDeletionPopup");
    if (popup) popup.remove();
  }

  function persistAggregateRun(resultLabel) {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
    const modeName = activeMode && ACTIONS[activeMode] ? ACTIONS[activeMode].popupLabel : (activeMode || "Action");
    const activity = {
      action: modeName,
      result: resultLabel || "Completed",
      processed: processedCount,
      inspected: dryRunInspectedCount,
      skipped: activeSkippedCount,
      errors: activeErrorCount,
      timestamp: new Date().toISOString().replace("T", " ").substring(0, 19),
    };
    chrome.storage.local.set({ recentActivity: activity }, () => {
      void chrome.runtime.lastError;
    });
  }

  function stopAutomation() {
    shouldRun = false;
    showStatus("Process stopping after current action...");
    persistAggregateRun("Stopped by user");
    send("automationStopped", { mode: activeMode, count: processedCount });
  }

  function isMessengerPage() {
    return (
      document.documentElement.dataset.deleteFacebookMessagesFixture === "true" ||
      /(^|\.)facebook\.com\/messages/i.test(
        location.hostname + location.pathname,
      ) || /(^|\.)messenger\.com$/i.test(location.hostname)
    );
  }

  function announceDryRun(message) {
    warnDiagnostic(`[DRY RUN] ${message}`);
    showStatus(`DRY RUN — ${message}`);
  }

  function dryRunResult(threadLabel, reason, actionLabel) {
    pressEscape();
    return {
      status: "inspected",
      reason,
      threadLabel,
      actionLabel,
      dryRun: true,
    };
  }

  let threadIdentitySequence = 0;
  function getThreadIdentity(el) {
    if (!el || !(el instanceof Element)) return null;
    const row =
      el.closest('[role="row"], [role="listitem"], article, div[role="gridcell"]') ||
      el;
    const hrefEl =
      row.querySelector('a[href*="/messages/t/"]') ||
      (row.tagName === "A" && row.getAttribute("href") ? row : null);
    if (hrefEl && hrefEl.getAttribute("href")) {
      return hrefEl.getAttribute("href");
    }
    const dataId = row.getAttribute("data-thread-id") || row.id;
    if (dataId) return `id:${dataId}`;
    if (!row.__thread_id) {
      threadIdentitySequence++;
      row.__thread_id = `thread-${threadIdentitySequence}`;
    }
    return row.__thread_id;
  }

  // ---------------------------------------------------------------------------
  // Messenger selectors/actions
  // ---------------------------------------------------------------------------
  function getThreadMenuButtons(skipIdentities = new Set()) {
    const primary = visibleElements(SELECTORS.threadMenuButton);
    const fallback = primary.length
      ? primary
      : visibleElements(SELECTORS.threadMenuButtonFallback);

    return fallback
      .map((el) => {
        const label = el.getAttribute("aria-label") || normalizedText(el);
        const identity = getThreadIdentity(el) || label;
        return {
          el,
          label,
          identity,
          top: el.getBoundingClientRect().top,
        };
      })
      .filter((item) => /^More options for/i.test(item.label || ""))
      .filter((item) => !skipIdentities.has(item.identity))
      .sort((a, b) => a.top - b.top);
  }

  async function openThreadMenu(menuButton) {
    const clickable = closestClickable(menuButton);
    if (!clickable) return null;

    const row = clickable.closest(
      '[role="row"], [role="listitem"], [aria-label], a[href]',
    );
    if (row) {
      dispatchMouse(row, "mouseover");
      dispatchMouse(row, "mouseenter");
      dispatchMouse(row, "mousemove");
      await sleep(150);
    }

    const preExistingRoots = new Set(visibleElements(SELECTORS.menuRoot));
    const controls = clickable.getAttribute ? clickable.getAttribute("aria-controls") : null;
    const initialControlled = controls ? document.getElementById(controls) : null;
    const initialControlledVisible = initialControlled ? isVisible(initialControlled) : false;
    const initialControlledRect = initialControlledVisible ? initialControlled.getBoundingClientRect() : null;

    realClick(clickable);

    const openedRoot = await waitFor(
      () => {
        // 1. If trigger specifies aria-controls, verify that controlled element
        if (controls) {
          const controlled = document.getElementById(controls);
          if (controlled && isVisible(controlled)) {
            // If it was not visible before, it's a newly opened menu
            if (!initialControlledVisible || !preExistingRoots.has(controlled)) {
              return controlled;
            }
            // If it was already visible before the click, reject unless we can establish
            // that it changed ownership/state (e.g. moved to align with target)
            const targetRow = row || clickable;
            const targetRect = targetRow.getBoundingClientRect();
            const currRect = controlled.getBoundingClientRect();
            const movedToTarget =
              initialControlledRect &&
              (Math.abs(currRect.top - initialControlledRect.top) > 5 ||
                Math.abs(currRect.left - initialControlledRect.left) > 5) &&
              Math.abs(currRect.top - targetRect.bottom) < 150;
            if (movedToTarget) {
              return controlled;
            }
          }
        }

        // 2. Check for a newly-opened menu root that was not open prior to click
        const currentRoots = visibleElements(SELECTORS.menuRoot);
        for (const root of currentRoots) {
          if (!preExistingRoots.has(root) && isVisible(root)) {
            const hasItems =
              queryAll(
                '[role="menuitem"], [role="menuitemradio"], button, [role="button"]',
                root,
              ).length > 0;
            if (hasItems) return root;
          }
        }

        // 3. Check for a menu contained within or adjacent to the clicked row
        if (row) {
          const rowMenu = row.querySelector(
            '[role="menu"], [id="thread-list-menu-buttons"]',
          );
          if (rowMenu && isVisible(rowMenu) && !preExistingRoots.has(rowMenu)) return rowMenu;
        }

        return null;
      },
      2500,
      100,
    );

    return openedRoot || null;
  }

  function getOpenMenuRoots() {
    return visibleElements(SELECTORS.menuRoot).filter((root) => {
      const text = normalizedText(root);
      return (
        text ||
        queryAll(
          '[role="menuitem"], [role="menuitemradio"], button, [role="button"]',
          root,
        ).length
      );
    });
  }

  function findActionMenuItem(actionConfig, targetRoot = null) {
    // Fail closed: Require a valid target root strictly owned by the triggered menu
    if (!targetRoot) return null;

    const exact = findVisibleByText(
      SELECTORS.menuItem,
      actionConfig.menuRegex,
      targetRoot,
    );
    if (exact) return exact;

    const loose = findVisibleByText(
      SELECTORS.menuItem,
      actionConfig.looseMenuRegex,
      targetRoot,
    );
    if (loose) return loose;

    return null;
  }

  function ancestorHasText(el, regex, maxDepth = 8) {
    let node = el;
    let depth = 0;

    while (node && node !== document.body && depth < maxDepth) {
      if (regex.test(normalizedText(node))) return true;
      node = node.parentElement;
      depth += 1;
    }

    return false;
  }

  function getConfirmationRoots() {
    const roots = visibleElements(
      [
        '[role="dialog"]',
        '[aria-modal="true"]',
        '[aria-label="Delete chat"]',
        '[aria-label="Delete conversation"]',
        "[aria-labelledby]",
        "[aria-describedby]",
      ].join(","),
    );

    return roots.filter((root) => {
      const text = normalizedText(root);
      return /delete chat|delete conversation|cannot be undone|delete your copy/i.test(
        text,
      );
    });
  }

  function getTopmostClickable(el) {
    if (!el) return null;

    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);

    if (!hit) return null;

    const clickable = hit.closest('[role="button"], button, [tabindex]');

    if (
      hit === el ||
      el.contains(hit) ||
      clickable === el ||
      (clickable && el.contains(clickable))
    ) {
      return clickable || el;
    }

    return null;
  }

  function findConfirmButton(actionConfig) {
    if (!actionConfig.confirmRegex) return null;

    const roots = getConfirmationRoots();
    if (roots.length === 0) return null;

    // Target the most recently mounted active confirmation dialog
    const activeRoot = roots[roots.length - 1];

    const candidates = visibleElements(
      '[role="button"], button, [role="link"], a[role="button"]',
      activeRoot,
    )
      .filter(
        (el) => !textMatches(el, /^(cancel|back|close|learn more|not now)$/i),
      )
      .filter((el) => textMatches(el, actionConfig.confirmRegex));

    const topmost = candidates
      .map((el) => ({ original: el, clickable: getTopmostClickable(el) }))
      .reverse()
      .find((item) => item.clickable);

    if (topmost) return topmost.clickable;

    return candidates[candidates.length - 1] || null;
  }

  function confirmationStillOpen(actionConfig) {
    if (!actionConfig.confirmRegex) return false;
    return Boolean(findConfirmButton(actionConfig));
  }

  function rectOf(el) {
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      bottom: Math.round(rect.bottom),
      right: Math.round(rect.right),
    };
  }

  function findMarketplaceHeaderMoreOptions() {
    // 1. Direct search within a recognized Marketplace banner/container
    const banner = findVisible(
      '#marketplace-banner, [aria-label*="Marketplace" i], [data-testid*="marketplace" i], [role="region"][aria-label*="Marketplace" i]',
    );
    if (banner) {
      const bannerBtn = visibleElements(
        '[role="button"][aria-label="More options"], button[aria-label="More options"]',
        banner,
      ).find(
        (el) =>
          /^More options$/i.test(ownAccessibleText(el)) ||
          el.getAttribute("aria-haspopup") === "dialog",
      );
      if (bannerBtn) return bannerBtn;
    }

    // 2. Main pane candidate search outside thread list
    const threadList = document.querySelector(
      '#thread-list, [role="navigation"], [aria-label="Conversations"]',
    );
    const threadListRight = threadList
      ? threadList.getBoundingClientRect().right
      : 0;

    const candidates = visibleElements(
      '[role="button"][aria-label="More options"][aria-haspopup="dialog"], button[aria-label="More options"][aria-haspopup="dialog"], [role="button"][aria-label="More options"], button[aria-label="More options"]',
    )
      .filter((el) => {
        if (threadList && threadList.contains(el)) return false;
        const aria = el.getAttribute("aria-label") || "";
        if (/^More options for/i.test(aria)) return false;
        return (
          /^More options$/i.test(ownAccessibleText(el)) ||
          el.getAttribute("aria-haspopup") === "dialog"
        );
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        let score = 0;

        // Contextual checks: is it near marketplace terms or item links?
        const container =
          el.closest(
            'div, section, header, [role="region"], [role="dialog"], article, main',
          ) || el.parentElement;
        const containerText = container ? normalizedText(container) : "";

        if (
          /marketplace|listing|sold|in stock|pending|see details|view listing/i.test(
            containerText,
          )
        ) {
          score += 100;
        }

        if (container && container.querySelector('a[href*="/marketplace/"]')) {
          score += 80;
        }

        // Semantic attributes
        if (el.getAttribute("aria-haspopup") === "dialog") {
          score += 30;
        }

        // Geometry as ranking heuristic only (main pane / header area)
        if (r.x >= threadListRight) {
          score += 20;
        }
        if (r.y >= 0 && r.y < window.innerHeight * 0.5) {
          score += 10;
        }
        if (r.width > 60) {
          score += 10;
        }

        return { el, score, r };
      })
      // Only consider candidates with meaningful marketplace context or main pane dialog button
      .filter((c) => c.score >= 50)
      .sort(
        (a, b) =>
          b.score - a.score || b.r.width - a.r.width || a.r.y - b.r.y,
      );

    return candidates[0] ? candidates[0].el : null;
  }

  function isMarketplaceDetailView() {
    if (!/\/messages\/t\//i.test(location.pathname) && !isFixturePage()) return false;

    // 1. Genuinely Marketplace item link inside conversation pane
    const hasMarketplaceItemLink = visibleElements(
      'a[href*="/marketplace/item/"], a[href*="/marketplace/"]',
    ).some((el) => {
      // Exclude generic global nav bar links outside conversation
      if (
        el.closest('nav, [role="navigation"]') &&
        !el.closest(
          'main, [role="main"], [aria-label*="Marketplace" i], #marketplace-banner',
        )
      ) {
        return false;
      }
      return true;
    });

    // 2. Marketplace product banner or specific badges/labels in the conversation view
    const hasMarketplaceProductBanner =
      visibleElements(
        '#marketplace-banner, [role="region"][aria-label*="Marketplace" i], [data-testid*="marketplace" i]',
      ).some(isVisible) ||
      visibleElements(
        '.marketplace-sub, [aria-label*="listing" i], a[href*="/marketplace/item/"]',
      ).some(isVisible);

    // 3. Marketplace specific header More Options
    const hasMarketplaceSpecificHeader = Boolean(findMarketplaceHeaderMoreOptions());

    return (
      hasMarketplaceItemLink ||
      hasMarketplaceProductBanner ||
      hasMarketplaceSpecificHeader
    );
  }

  async function ensureMarketplaceConversationVisible() {
    if (findMarketplaceHeaderMoreOptions()) return true;

    const firstThread = visibleElements(
      '#thread-list [role="listitem"], #thread-list article, div[role="gridcell"], a[href*="/messages/t/"]',
    ).find(isVisible);

    if (!firstThread) return false;

    logDiagnostic("Opening Marketplace conversation from list");
    realClick(firstThread);

    return Boolean(
      await waitFor(() => findMarketplaceHeaderMoreOptions(), 2000, 100),
    );
  }

  async function openMarketplaceHeaderOptions() {
    const moreButton = await waitFor(
      () => findMarketplaceHeaderMoreOptions(),
      4000,
      100,
    );
    if (!moreButton) return null;

    const clickable = closestClickable(moreButton) || moreButton;
    logDiagnostic("Opening Marketplace header More options");

    const preExistingRoots = new Set(visibleElements(SELECTORS.menuRoot));
    const controls = clickable.getAttribute ? clickable.getAttribute("aria-controls") : null;
    const initialControlled = controls ? document.getElementById(controls) : null;
    const initialControlledVisible = initialControlled ? isVisible(initialControlled) : false;
    const initialControlledRect = initialControlledVisible ? initialControlled.getBoundingClientRect() : null;

    realClick(clickable);

    const opened = await waitFor(
      () => {
        // 1. If trigger specifies aria-controls, verify that controlled element
        if (controls) {
          const controlled = document.getElementById(controls);
          if (controlled && isVisible(controlled)) {
            if (!initialControlledVisible || !preExistingRoots.has(controlled)) {
              return controlled;
            }
            const targetRect = clickable.getBoundingClientRect();
            const currRect = controlled.getBoundingClientRect();
            const movedToTarget =
              initialControlledRect &&
              (Math.abs(currRect.top - initialControlledRect.top) > 5 ||
                Math.abs(currRect.left - initialControlledRect.left) > 5) &&
              Math.abs(currRect.top - targetRect.bottom) < 150;
            if (movedToTarget) {
              return controlled;
            }
          }
        }

        // 2. Check for a newly-opened menu root that was not open prior to click
        const currentRoots = visibleElements(SELECTORS.menuRoot);
        for (const root of currentRoots) {
          if (!preExistingRoots.has(root) && isVisible(root)) {
            const hasItems =
              queryAll(
                '[role="menuitem"], [role="menuitemradio"], button, [role="button"]',
                root,
              ).length > 0;
            if (hasItems) return root;
          }
        }

        // 3. Check for a menu contained within the clicked header button container
        const container = clickable.closest('header, [role="banner"], [role="region"], div');
        if (container) {
          const containerMenu = container.querySelector(
            '[role="menu"], [id="thread-list-menu-buttons"]',
          );
          if (containerMenu && isVisible(containerMenu) && !preExistingRoots.has(containerMenu)) {
            return containerMenu;
          }
        }

        return null;
      },
      4000,
      100,
    );

    return opened || null;
  }

  async function performCurrentMarketplaceConversationDelete(actionConfig, skipLabels) {
    if (!isMarketplaceDetailView()) {
      const reopened = await ensureMarketplaceConversationVisible();
      if (!reopened) return { status: "empty" };
    }

    const title =
      visibleElements('[aria-label^="Conversation titled"]').map(
        normalizedText,
      )[0] || "current Marketplace conversation";

    if (skipLabels && skipLabels.has(title)) {
      logDiagnostic("Marketplace conversation already processed");
      return { status: "empty" };
    }
    showStatus(
      `${actionConfig.popupLabel}: ${formatNumber(processedCount)} | Opening Marketplace options`,
    );

    const menuOpened = await openMarketplaceHeaderOptions();
    if (!menuOpened) {
      warnDiagnostic("Marketplace header More options could not be opened.");
      return {
        status: "skipped",
        reason: "marketplace_header_menu_not_opened",
        threadLabel: title,
      };
    }

    const actionItem = await waitFor(
      () => findActionMenuItem(actionConfig, menuOpened),
      4000,
      100,
    );
    if (!actionItem) {
      warnDiagnostic(
        `${actionConfig.label} item not found in Marketplace header options.`,
      );
      pressEscape();
      await sleep(300);
      return {
        status: "skipped",
        reason: "marketplace_delete_item_missing",
        threadLabel: title,
      };
    }

    if (dryRunActive) {
      const actionLabel = normalizedText(actionItem) || actionConfig.label;
      announceDryRun(
        `Found Marketplace thread: ${title}. Found menu action: ${actionLabel}. Would stop before selecting it.`,
      );
      skipLabels.add(title);
      pressEscape();
      await sleep(200);
      dryRunInspectedCount += 1;
      send("dryRunProgress", {
        mode: activeMode,
        count: 0,
        inspectedCount: dryRunInspectedCount,
        threadLabel: title,
        actionLabel,
      });
      showStatus(`DRY RUN — Inspected Marketplace: ${title}`);
      return dryRunResult(title, "dry_run_action_not_selected", actionLabel);
    }

    logDiagnostic(
      `Clicking Marketplace ${actionConfig.label} item`,
    );
    showStatus(
      `${actionConfig.popupLabel}: ${formatNumber(processedCount)} | Clicking ${normalizedText(actionItem) || actionConfig.label}`,
    );
    realClick(actionItem);

    if (actionConfig.requiresConfirm) {
      const confirmButton = await waitFor(
        () => findConfirmButton(actionConfig),
        10000,
        100,
      );

      if (!confirmButton) {
        warnDiagnostic("Marketplace confirm button not found.");
        pressEscape();
        await sleep(300);
        return {
          status: "skipped",
          reason: "marketplace_confirm_missing",
          threadLabel: title,
        };
      }

      logDiagnostic("Confirming Marketplace delete");
      showStatus(
        `${actionConfig.popupLabel}: ${formatNumber(processedCount)} | Confirming action`,
      );
      realClick(confirmButton);

      const closed = await waitFor(
        () => !confirmationStillOpen(actionConfig),
        5000,
        150,
      );
      if (!closed) {
        const retryButton = findConfirmButton(actionConfig);
        if (retryButton) {
          warnDiagnostic(
            "Marketplace confirmation still open; retrying topmost confirm button.",
          );
          realClick(retryButton);
          await sleep(800);
        }
      }

      const finalClosed = await waitFor(
        () => !confirmationStillOpen(actionConfig),
        5000,
        150,
      );
      if (!finalClosed) {
        warnDiagnostic("Marketplace confirmation did not close after retry.");
        return {
          status: "skipped",
          reason: "marketplace_confirm_not_closed",
          threadLabel: title,
        };
      }
    }

    processedCount += 1;
    showStatus(`${actionConfig.popupLabel}: ${formatNumber(processedCount)}`);
    send(actionConfig.progressAction, {
      mode: activeMode,
      count: processedCount,
      threadLabel: title,
    });


    await actionDelay();

    if (skipLabels) {
      skipLabels.add(title);
    }

    return { status: "done", threadLabel: title };
  }

  async function performOneThreadAction(actionConfig, skipIdentities) {
    const buttons = getThreadMenuButtons(skipIdentities);
    const target = buttons[0];

    if (!target) {
      if (activeMode === "deleteBuySell") {
        const marketplaceResult =
          await performCurrentMarketplaceConversationDelete(actionConfig, skipIdentities);
        if (marketplaceResult.status !== "empty") return marketplaceResult;
      }

      return { status: "empty" };
    }

    const threadLabel = target.label || "Unknown thread";
    logDiagnostic("Opening thread menu");
    showStatus(
      `${actionConfig.popupLabel}: ${formatNumber(processedCount)} | Opening ${threadLabel.replace(/^More options for\s*/i, "")}`,
    );

    const menuOpened = await openThreadMenu(target.el);
    if (!menuOpened) {
      warnDiagnostic("Could not open menu for thread");
      skipIdentities.add(target.identity);
      pressEscape();
      await sleep(300);
      return { status: "skipped", reason: "menu_not_opened", threadLabel };
    }

    const actionItem = await waitFor(
      () => findActionMenuItem(actionConfig, menuOpened),
      4000,
      100,
    );
    if (!actionItem) {
      warnDiagnostic(
        `${actionConfig.label} menu item not found`,
      );
      skipIdentities.add(target.identity);
      pressEscape();
      await sleep(300);
      return { status: "skipped", reason: "menu_item_missing", threadLabel };
    }

    if (dryRunActive) {
      const actionLabel = normalizedText(actionItem) || actionConfig.label;
      announceDryRun(
        `Found thread: ${threadLabel.replace(/^More options for\s*/i, "")}. Found menu action: ${actionLabel}. Would stop before selecting it.`,
      );
      skipIdentities.add(target.identity);
      pressEscape();
      await sleep(200);
      dryRunInspectedCount += 1;
      send("dryRunProgress", {
        mode: activeMode,
        count: 0,
        inspectedCount: dryRunInspectedCount,
        threadLabel,
        actionLabel,
      });
      showStatus(
        `DRY RUN — Inspected ${dryRunInspectedCount}: ${threadLabel.replace(/^More options for\s*/i, "")}`,
      );
      return dryRunResult(threadLabel, "dry_run_action_not_selected", actionLabel);
    }

    logDiagnostic(
      `Clicking ${actionConfig.label} item`,
    );
    realClick(actionItem);

    if (actionConfig.requiresConfirm) {
      showStatus(
        `${actionConfig.popupLabel}: ${formatNumber(processedCount)} | Waiting for confirmation`,
      );

      const confirmButton = await waitFor(
        () => findConfirmButton(actionConfig),
        10000,
        100,
      );

      if (!confirmButton) {
        warnDiagnostic(
          `Confirm button not found for ${actionConfig.label}`,
        );
        skipIdentities.add(target.identity);
        pressEscape();
        await sleep(300);
        return { status: "skipped", reason: "confirm_missing", threadLabel };
      }

      showStatus(
        `${actionConfig.popupLabel}: ${formatNumber(processedCount)} | Confirming action`,
      );
      logDiagnostic(
        `Confirming ${actionConfig.label}`,
      );
      realClick(confirmButton);

      const closed = await waitFor(
        () => !confirmationStillOpen(actionConfig),
        3500,
        150,
      );

      if (!closed) {
        warnDiagnostic(
          "Confirmation dialog still appears open; retrying confirm click once.",
        );
        const retryButton = findConfirmButton(actionConfig);
        if (retryButton) {
          realClick(retryButton);
          await sleep(400);
        } else {
          pressEnterOn(confirmButton);
          await sleep(400);
        }
      }

      const finalClosed = await waitFor(
        () => !confirmationStillOpen(actionConfig),
        3500,
        150,
      );
      if (!finalClosed) {
        warnDiagnostic(
          `Confirmation did not close for ${actionConfig.label}`,
        );
        skipIdentities.add(target.identity);
        return { status: "skipped", reason: "confirm_not_closed", threadLabel };
      }
    }

    processedCount += 1;
    showStatus(`${actionConfig.popupLabel}: ${formatNumber(processedCount)}`);
    send(actionConfig.progressAction, {
      mode: activeMode,
      count: processedCount,
      threadLabel,
    });


    await actionDelay();
    return { status: "done", threadLabel };
  }

  async function runThreadLoop(mode, options = {}) {
    if (busy) {
      console.warn("Automation is already running:", activeMode);
      return;
    }

    if (!isMessengerPage()) {
      send("automationError", {
        mode,
        message: "Open Facebook Messages or Messenger first.",
      });
      return;
    }

    const actionConfig = ACTIONS[mode];
    if (!actionConfig) {
      send("automationError", { mode, message: `Unknown mode: ${mode}` });
      return;
    }

    busy = true;
    shouldRun = true;
    activeMode = mode;
    dryRunActive = Boolean(options.dryRun);

    // Production default behavior remains unlimited (Infinity) unless explicitly constrained.
    // Callers may pass an explicit maxActions (e.g. for testing specific batches), or enable
    // an explicit development safety option (developmentSafetyLimit or safeTestMode).
    const requestedMax = Number(options.maxActions);
    if (Number.isFinite(requestedMax) && requestedMax > 0) {
      maxActions = Math.floor(requestedMax);
    } else if (options.developmentSafetyLimit || options.safeTestMode) {
      maxActions = 1;
    } else {
      maxActions = Infinity;
    }
    processedCount = 0;
    dryRunInspectedCount = 0;
    activeSkippedCount = 0;
    activeErrorCount = 0;
    const skippedIdentities = new Set();
    const inspectedIdentities = new Set();

    await loadSpeed();

    if (dryRunActive) {
      announceDryRun(
        `${actionConfig.popupLabel} is active. No menu action or confirmation will be clicked.`,
      );
    } else if (Number.isFinite(maxActions)) {
      console.warn(`[SAFETY LIMIT] Automation will stop after ${maxActions} action(s).`);
      showStatus(`${actionConfig.popupLabel}: safety limit ${maxActions} action(s)`);
    } else {
      showStatus(`${actionConfig.popupLabel}: starting...`);
    }
    send(actionConfig.startedAction, { mode, dryRun: dryRunActive, maxActions });

    try {
      if (mode === "deleteBuySell" && !isMarketplaceDetailView()) {
        if (!isMarketplaceFolder()) {
          showStatus("Opening Marketplace messages...");
          await openMarketplaceMessages();
          await sleep(500);
        }
        if (!isMarketplaceFolder() && !isMarketplaceDetailView()) {
          console.warn("Could not confirm Marketplace folder; aborting deleteBuySell for safety.");
          send("automationError", {
            mode,
            message: "Could not confirm Marketplace messages folder. Aborting to protect inbox messages.",
          });
          return;
        }
      } else if (mode === "delete" || mode === "archive") {
        if (isMarketplaceFolder() || isMarketplaceDetailView() || isArchivedFolder()) {
          showStatus("Opening regular messages...");
          await openInboxMessages();
          await sleep(500);
        }
        if (isMarketplaceFolder() || isMarketplaceDetailView()) {
          console.warn("Still in Marketplace view; aborting regular action for safety.");
          send("automationError", {
            mode,
            message: "Cannot execute regular action while in Marketplace view. Aborting for safety.",
          });
          return;
        }
      } else if (mode === "unarchive") {
        if (!isArchivedFolder()) {
          showStatus("Opening Archived chats...");
          await openArchivedMessages();
          await sleep(500);
        }
      }

      while (shouldRun) {
        const result = await performOneThreadAction(
          actionConfig,
          dryRunActive ? inspectedIdentities : skippedIdentities,
        );

        if (result.status === "empty") {
          const completionMessage = dryRunActive
            ? `Dry run finished. Inspected ${dryRunInspectedCount} conversation(s). No actions were executed.`
            : actionConfig.emptyMessage;
          console.log(completionMessage);
          persistAggregateRun(dryRunActive ? "Dry run complete" : "Completed");
          send(actionConfig.completeAction, {
            mode,
            count: processedCount,
            inspectedCount: dryRunInspectedCount,
            dryRun: dryRunActive,
            message: completionMessage,
          });
          showStatus(
            dryRunActive
              ? `Dry run complete: ${dryRunInspectedCount} inspected`
              : `${actionConfig.emptyMessage}. Total: ${formatNumber(processedCount)}`,
          );
          await sleep(1200);
          break;
        }

        if (result.status === "inspected") {
          if (dryRunInspectedCount >= maxActions) {
            console.log(`[DRY RUN] Reached inspection limit of ${maxActions} thread(s).`);
            shouldRun = false;
            persistAggregateRun("Dry run complete");
            send(actionConfig.completeAction, {
              mode,
              count: 0,
              inspectedCount: dryRunInspectedCount,
              dryRun: true,
              message: `Dry run reached inspection limit of ${dryRunInspectedCount} thread(s).`,
            });
            showStatus(`Dry run complete: ${dryRunInspectedCount} inspected`);
            await sleep(1200);
            break;
          }
          await sleep(100);
          continue;
        }

        if (result.status === "skipped") {
          activeSkippedCount++;
          send("automationWarning", {
            mode,
            count: processedCount,
            reason: result.reason,
            threadLabel: result.threadLabel,
          });

          if (
            skippedIdentities.size >= Math.max(1, getThreadMenuButtons().length)
          ) {
            console.warn("All visible thread menus were skipped; stopping.");
            persistAggregateRun("All items skipped");
            send(actionConfig.completeAction, {
              mode,
              count: processedCount,
              message: actionConfig.emptyMessage,
            });
            showStatus(
              `${actionConfig.emptyMessage}. Total: ${formatNumber(processedCount)}`,
            );
            await sleep(1200);
            break;
          }
        }

        if (processedCount >= maxActions) {
          console.warn(`[SAFETY LIMIT] Reached ${maxActions} completed action(s).`);
          shouldRun = false;
          persistAggregateRun("Safety limit reached");
          send(actionConfig.completeAction, {
            mode,
            count: processedCount,
            message: `Safety limit reached after ${processedCount} action(s).`,
          });
        }
      }
    } catch (err) {
      console.error(`${actionConfig.label} loop failed:`, err);
      activeErrorCount++;
      persistAggregateRun("Error");
      send(actionConfig.errorAction, {
        mode,
        count: processedCount,
        message: err && err.message ? err.message : String(err),
      });
      showStatus(
        `${actionConfig.label} failed: ${err && err.message ? err.message : err}`,
      );
      await sleep(1500);
    } finally {
      shouldRun = false;
      busy = false;
      activeMode = null;
      dryRunActive = false;
      maxActions = Infinity;
      dryRunInspectedCount = 0;
      hideStatus();
    }
  }

  function isMarketplaceFolder() {
    if (isFixturePage()) {
      return (
        document.querySelector("#marketplace-entry")?.classList.contains("active") ||
        document.querySelector("#marketplace-banner")?.style.display !== "none"
      );
    }

    // Determine Marketplace state using Messenger-specific context only.
    // Never rely on generic site-wide Facebook marketplace links (e.g. top nav a[href*="/marketplace/"]).

    // 1. Messenger route state
    if (/\/messages\/marketplace/i.test(location.pathname)) {
      return true;
    }

    // 2. Active Messenger navigation folder item specifically for Marketplace
    const activeNavMarketplace = visibleElements(
      'nav a[href*="/marketplace/"], [role="navigation"] a[href*="/marketplace/"]',
    ).some((el) => {
      const isCurrent =
        el.getAttribute("aria-current") === "page" ||
        el.getAttribute("aria-selected") === "true";
      const hasActiveClass = /(?:^|\s)(?:active|selected)(?:\s|$)/i.test(
        el.className || "",
      );
      return isCurrent || hasActiveClass;
    });
    if (activeNavMarketplace) return true;

    // 3. Messenger chats list heading specifically indicating Marketplace
    const hasMarketplaceHeading = visibleElements(
      'div[role="navigation"] h1, div[role="navigation"] h2, div[role="navigation"] [role="heading"], [aria-label="Chats"] [role="heading"], [aria-label="Chats"] h1, [aria-label="Chats"] h2',
    ).some((el) => /^Marketplace$/i.test(normalizedText(el)));
    if (hasMarketplaceHeading) return true;

    // 4. In-conversation Marketplace listing banner
    if (isMarketplaceDetailView()) {
      return true;
    }

    return false;
  }

  function isArchivedFolder() {
    if (isFixturePage()) {
      return (
        document.querySelector("#fixture-status")?.textContent?.includes("Archived") ||
        false
      );
    }
    return visibleElements(
      'div[role="navigation"] h1, div[role="navigation"] h2, div[role="navigation"] [role="heading"], [aria-label="Chats"] [role="heading"], h1, h2, [role="heading"]',
    ).some((el) =>
      /^Archived chats/i.test(normalizedText(el)),
    );
  }

  async function openInboxMessages() {
    if (!isMessengerPage()) return false;

    if (isFixturePage()) {
      const inboxNav = document.querySelector("#inbox-entry");
      if (inboxNav) {
        realClick(inboxNav);
        await sleep(300);
        return true;
      }
    }

    const candidate = visibleElements(
      'a[aria-label="Chats"], [role="link"][aria-label="Chats"], a[href="/messages/"], a[href="/messages/t/"], [aria-label="Back to chats"], [aria-label="Back"], [role="button"][aria-label="Back"]',
    ).find((el) => {
      const label = (el.getAttribute("aria-label") || "").trim();
      const text = normalizedText(el);
      return /^(Chats|Back to chats|Back)$/i.test(label) || /^(Chats|Inbox)$/i.test(text);
    });

    if (candidate) {
      logDiagnostic("Navigating back to regular chats/inbox");
      realClick(candidate);
      await sleep(500);
      return true;
    }
    return false;
  }

  async function openMarketplaceMessages() {
    if (!isMessengerPage()) {
      send("noBuySell", { message: "Open Facebook Messages first." });
      return;
    }

    send("BuySellLoadingWait");

    try {
      const candidate = await waitFor(
        () => {
          const exact = visibleElements(SELECTORS.marketplaceCandidate).find(
            (el) => {
              const text = normalizedText(el);
              return (
                /^Marketplace\b/i.test(text) ||
                /^Marketplace\s*[·•]/i.test(text)
              );
            },
          );

          if (exact) return exact;

          return visibleElements(SELECTORS.marketplaceCandidate).find((el) =>
            /\bMarketplace\b/i.test(normalizedText(el)),
          );
        },
        5000,
        100,
      );

      if (!candidate) {
        warnDiagnostic("Marketplace messages entry not found.");
        send("noBuySell");
        return;
      }

      logDiagnostic("Opening Marketplace messages");
      realClick(candidate);
      await sleep(800);
      send("loadedCompleteBuySell");
    } catch (err) {
      console.error("Could not open Marketplace messages:", err);
      send("clickError", {
        error: err && err.message ? err.message : String(err),
      });
      send("noBuySell");
    }
  }

  async function openArchivedMessages() {
    if (!isMessengerPage()) {
      send("archiveError", { message: "Open Facebook Messages first." });
      return;
    }

    try {
      const settings = await waitFor(
        () => findVisible(SELECTORS.settingsButton),
        5000,
        100,
      );
      if (!settings) {
        warnDiagnostic("Settings, help and more button not found.");
        send("archiveError", { message: "Settings menu not found." });
        return;
      }

      logDiagnostic("Opening settings menu");
      realClick(settings);

      const archivedItem = await waitFor(
        () => {
          const roots = getOpenMenuRoots();
          for (const root of roots) {
            const item =
              findVisibleByText(
                SELECTORS.menuItem,
                /^(archived chats|archived)$/i,
                root,
              ) ||
              findVisibleByText(
                SELECTORS.menuItem,
                /\barchived chats\b/i,
                root,
              );
            if (item) return item;
          }
          return findVisibleByText(
            '[role="menuitem"], [role="menuitemradio"]',
            /\barchived chats\b/i,
          );
        },
        5000,
        100,
      );

      if (!archivedItem) {
        warnDiagnostic("Archived chats menu item not found.");
        send("archiveError", {
          message: "Archived chats menu item not found.",
        });
        pressEscape();
        return;
      }

      logDiagnostic("Opening Archived chats");
      realClick(archivedItem);
      await sleep(800);
      send("loadedCompleteArchived");
    } catch (err) {
      if (isFixturePage()) {
        console.error("Could not open Archived chats:", err);
      }
      send("archiveError", {
        message: err && err.message ? err.message : String(err),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Message bridge from popup
  // ---------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const action = request && request.action;
    console.log("📨 Message received:", action);

    const loopActions = new Set([
      "deleteMsgs",
      "archiveMsgs",
      "deleteBuySell",
      "unarchiveAll",
    ]);
    if (loopActions.has(action) && busy) {
      sendResponse &&
        sendResponse({
          ok: false,
          message: `Automation is already running (${activeMode || "unknown"}).`,
          busy: true,
        });
      return false;
    }

    switch (action) {
      case "deleteMsgs":
        runThreadLoop("delete", request);
        sendResponse && sendResponse({ ok: true });
        return true;

      case "archiveMsgs":
        runThreadLoop("archive", request);
        sendResponse && sendResponse({ ok: true });
        return true;

      case "BuySell":
        openMarketplaceMessages();
        sendResponse && sendResponse({ ok: true });
        return true;

      case "deleteBuySell":
        runThreadLoop("deleteBuySell", request);
        sendResponse && sendResponse({ ok: true });
        return true;

      case "openArchivedMsgs":
        openArchivedMessages();
        sendResponse && sendResponse({ ok: true });
        return true;

      case "unarchiveAll":
        runThreadLoop("unarchive", request);
        sendResponse && sendResponse({ ok: true });
        return true;

      case "stopAutomation":
        stopAutomation();
        sendResponse && sendResponse({ ok: true });
        return true;

      case "getAutomationState":
        sendResponse &&
          sendResponse({
            ok: true,
            running: busy,
            stopping: busy && !shouldRun,
            mode: activeMode,
            dryRun: dryRunActive,
            processed: processedCount,
            inspected: dryRunInspectedCount,
            skipped: activeSkippedCount,
            errors: activeErrorCount,
          });
        return false;

      case "debugSelectors": {
        const payload = getDebugSnapshot();
        sendResponse && sendResponse({ ok: true, payload });
        return true;
      }

      default:
        sendResponse &&
          sendResponse({ ok: false, message: `Unknown action: ${action}` });
        return false;
    }
  });

  function getDebugSnapshot() {
    const buttons = getThreadMenuButtons();

    const snapshot = {
      url: location.href,
      title: document.title,
      threadMenuButtonCount: buttons.length,
      settingsButtonFound: Boolean(findVisible(SELECTORS.settingsButton)),
      visibleDialogs: visibleElements(SELECTORS.dialog).length,
      visibleConfirmationRoots: getConfirmationRoots().length,
      visibleConfirmButtons: ACTIONS.delete
        ? visibleElements(SELECTORS.confirmButtonCandidate)
            .filter((el) =>
              ACTIONS.delete.confirmRegex.test(normalizedText(el)),
            )
            .map((el) => normalizedText(el))
            .slice(0, 10)
        : [],
      visibleMenus: visibleElements('[role="menu"]').length,
      buttons: buttons.slice(0, 40).map((item, index) => ({
        index,
        label: item.label,
        text: normalizedText(item.el),
        top: Math.round(item.top),
      })),
    };

    if (isFixturePage()) {
      console.table(snapshot.buttons);
      console.log("Delete Facebook Messages selector snapshot:", snapshot);
    }
    return snapshot;
  }

  // Expose debug surface only on local test fixture pages.
  if (isFixturePage()) {
    window.DeleteFacebookMessagesDebug = {
      selectors: SELECTORS,
      snapshot: getDebugSnapshot,
      stop: stopAutomation,
      isFixturePage,
      isBusy: () => busy,
      isMarketplaceFolder,
      isMarketplaceDetailView,
      findMarketplaceHeaderMoreOptions,
      isArchivedFolder,
      openInboxMessages,
      openMarketplaceMessages,
      getInspectedCount: () => dryRunInspectedCount,
      getProcessedCount: () => processedCount,
    };
  }
})();
