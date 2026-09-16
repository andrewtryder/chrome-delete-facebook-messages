console.log("🚀 FBChats Cleaner - script.js injected successfully");
console.log("Current URL:", window.location.href);

(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Runtime state
  // ---------------------------------------------------------------------------
  let processedCount = 0;
  let shouldRun = false;
  let busy = false;
  let activeMode = null;
  let actionDelaySeconds = 5;
  let dryRunActive = false;
  let maxActions = Infinity;

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
    console.log(
      `⏳ Waiting ${Math.round(totalMs / 1000)} seconds before next action`,
    );
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

  function realClick(rawEl) {
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

    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const events = [
      "pointerover",
      "pointerenter",
      "pointermove",
      "mouseover",
      "mouseenter",
      "mousemove",
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup",
    ];

    for (const type of events) {
      const EventCtor =
        type.startsWith("pointer") && typeof PointerEvent === "function"
          ? PointerEvent
          : MouseEvent;

      el.dispatchEvent(
        new EventCtor(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons: type.endsWith("down") ? 1 : 0,
        }),
      );
    }

    // Dispatch pointer/mouse affordance events, then exactly one logical click.
    // Do not dispatch a synthetic click *and* call click(): React and native
    // controls can treat those as two separate user actions.
    if (typeof el.click === "function") el.click();

    return true;
  }

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
      title.textContent = "🗑️ Delete Facebook Messages Fast 2026";
      title.style.cssText =
        "display:flex;align-items:center;font-size:16px;font-weight:normal;gap:8px;white-space:nowrap";

      const body = document.createElement("div");
      body.className = "popup-message";
      body.style.cssText =
        "flex-grow:1;text-align:center;font-size:20px;font-weight:500";

      const stop = document.createElement("button");
      stop.id = "stopDeletionButton";
      stop.textContent = "✋ Stop";
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

  function stopAutomation() {
    shouldRun = false;
    showStatus("Process stopping after current action...");
    send("automationStopped", { mode: activeMode, count: processedCount });
  }

  function isMessengerPage() {
    return (
      document.documentElement.dataset.fbCleanerFixture === "true" ||
      /(^|\.)facebook\.com\/messages/i.test(
        location.hostname + location.pathname,
      ) || /(^|\.)messenger\.com$/i.test(location.hostname)
    );
  }

  function isFixturePage() {
    return document.documentElement.dataset.fbCleanerFixture === "true";
  }

  function announceDryRun(message) {
    console.warn(`[DRY RUN] ${message}`);
    showStatus(`DRY RUN — ${message}`);
  }

  function dryRunResult(threadLabel, reason) {
    pressEscape();
    return { status: "skipped", reason, threadLabel, dryRun: true };
  }

  // ---------------------------------------------------------------------------
  // Messenger selectors/actions
  // ---------------------------------------------------------------------------
  function getThreadMenuButtons(skipLabels = new Set()) {
    const primary = visibleElements(SELECTORS.threadMenuButton);
    const fallback = primary.length
      ? primary
      : visibleElements(SELECTORS.threadMenuButtonFallback);

    return fallback
      .map((el) => ({
        el,
        label: el.getAttribute("aria-label") || normalizedText(el),
        top: el.getBoundingClientRect().top,
      }))
      .filter((item) => /^More options for/i.test(item.label || ""))
      .filter((item) => !skipLabels.has(item.label))
      .sort((a, b) => a.top - b.top);
  }

  async function openThreadMenu(menuButton) {
    const clickable = closestClickable(menuButton);
    if (!clickable) return false;

    const row = clickable.closest(
      '[role="row"], [role="listitem"], [aria-label], a[href]',
    );
    if (row) {
      dispatchMouse(row, "mouseover");
      dispatchMouse(row, "mouseenter");
      dispatchMouse(row, "mousemove");
      await sleep(150);
    }

    realClick(clickable);

    const opened = await waitFor(
      () => {
        const menuItem = findVisible(
          '[role="menuitem"], [role="menuitemradio"]',
        );
        if (menuItem) return menuItem;

        const controls = clickable.getAttribute("aria-controls");
        if (controls) {
          const controlled = document.getElementById(controls);
          if (controlled && isVisible(controlled)) return controlled;
        }

        return null;
      },
      2500,
      100,
    );

    return Boolean(opened);
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

  function findActionMenuItem(actionConfig) {
    const roots = getOpenMenuRoots();

    for (const root of roots) {
      const exact = findVisibleByText(
        SELECTORS.menuItem,
        actionConfig.menuRegex,
        root,
      );
      if (exact) return exact;
    }

    for (const root of roots) {
      const loose = findVisibleByText(
        SELECTORS.menuItem,
        actionConfig.looseMenuRegex,
        root,
      );
      if (loose) return loose;
    }

    const exactGlobal = findVisibleByText(
      '[role="menuitem"], [role="menuitemradio"]',
      actionConfig.menuRegex,
    );
    if (exactGlobal) return exactGlobal;

    return findVisibleByText(
      '[role="menuitem"], [role="menuitemradio"]',
      actionConfig.looseMenuRegex,
    );
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

    const contextRegex =
      /delete chat|delete conversation|cannot be undone|delete your copy/i;

    const candidates = visibleElements(
      [
        '[role="dialog"][aria-label="Delete chat"] [role="button"]',
        '[role="dialog"][aria-label="Delete conversation"] [role="button"]',
        '[aria-modal="true"] [role="button"]',
        '[role="button"][aria-label="Delete chat"]',
        '[role="button"][aria-label="Delete conversation"]',
        "button",
      ].join(","),
    )
      .filter((el) => !textMatches(el, /^cancel$/i))
      .filter((el) => textMatches(el, actionConfig.confirmRegex))
      .filter((el) => ancestorHasText(el, contextRegex, 10));

    const topmost = candidates
      .map((el) => ({ original: el, clickable: getTopmostClickable(el) }))
      .reverse()
      .find((item) => item.clickable);

    if (topmost) return topmost.clickable;

    const roots = getConfirmationRoots();

    for (const root of roots) {
      const exact = visibleElements(SELECTORS.confirmButtonCandidate, root)
        .filter((el) => !textMatches(el, /^cancel$/i))
        .find((el) => textMatches(el, actionConfig.confirmRegex));

      if (exact) return getTopmostClickable(exact) || exact;
    }

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

  function isMarketplaceDetailView() {
    if (!/\/messages\/t\//i.test(location.pathname) && !isFixturePage()) return false;

    const hasMarketplaceBanner = visibleElements(
      'a[href*="/marketplace/item/"], [role="button"][aria-label="More options"][aria-haspopup="dialog"]',
    ).some((el) => {
      const text = normalizedText(el);
      return /marketplace|sold|see details|more options/i.test(text);
    });

    const hasConversationTitle =
      visibleElements('[aria-label^="Conversation titled"]').length > 0;

    return hasMarketplaceBanner || hasConversationTitle;
  }

  function findMarketplaceHeaderMoreOptions() {
    const candidates = visibleElements(
      '[role="button"][aria-label="More options"][aria-haspopup="dialog"], button[aria-label="More options"]',
    )
      .filter((el) => /^More options$/i.test(ownAccessibleText(el)))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        // Marketplace product banner button: below the chat title, above message history, in the main pane.
        return (
          r.width > 120 && r.height >= 24 && r.x > 300 && r.y > 110 && r.y < 280
        );
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        // Prefer the wide right-side product-banner More options button.
        return br.width - ar.width || ar.y - br.y;
      });

    return candidates[0] || null;
  }

  async function ensureMarketplaceConversationVisible() {
    if (findMarketplaceHeaderMoreOptions()) return true;

    const firstThread = visibleElements(
      '#thread-list [role="listitem"], #thread-list article, div[role="gridcell"], a[href*="/messages/t/"]',
    ).find(isVisible);

    if (!firstThread) return false;

    console.log(
      "Opening Marketplace conversation from list:",
      normalizedText(firstThread),
    );
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

    console.log("Opening Marketplace header More options:", {
      text: normalizedText(moreButton),
      ariaLabel: moreButton.getAttribute("aria-label"),
      rect: rectOf(moreButton),
    });

    realClick(moreButton);

    const opened = await waitFor(
      () => {
        const roots = getOpenMenuRoots();
        const usefulRoot = roots.find((root) =>
          /delete|archive|report|block|conversation|chat/i.test(
            normalizedText(root),
          ),
        );
        if (usefulRoot) return usefulRoot;

        return findVisibleByText(
          '[role="button"], button, [role="menuitem"]',
          /\b(delete|archive|report|block)\b/i,
        );
      },
      4000,
      100,
    );

    return opened;
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
      console.log("Marketplace conversation already processed:", title);
      return { status: "empty" };
    }
    showStatus(
      `${actionConfig.popupLabel}: ${formatNumber(processedCount)} | Opening Marketplace options`,
    );

    const menuOpened = await openMarketplaceHeaderOptions();
    if (!menuOpened) {
      console.warn("Marketplace header More options could not be opened.");
      return {
        status: "skipped",
        reason: "marketplace_header_menu_not_opened",
        threadLabel: title,
      };
    }

    const actionItem = await waitFor(
      () => findActionMenuItem(actionConfig),
      4000,
      100,
    );
    if (!actionItem) {
      console.warn(
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
      announceDryRun(
        `Found Marketplace thread: ${title}. Found menu action: ${normalizedText(actionItem) || actionConfig.label}. Would stop before selecting it.`,
      );
      return dryRunResult(title, "dry_run_action_not_selected");
    }

    console.log(
      `Clicking Marketplace ${actionConfig.label} item:`,
      normalizedText(actionItem),
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
        console.warn("Marketplace confirm button not found.");
        pressEscape();
        await sleep(300);
        return {
          status: "skipped",
          reason: "marketplace_confirm_missing",
          threadLabel: title,
        };
      }

      console.log(
        "Confirming Marketplace delete:",
        normalizedText(confirmButton),
      );
      showStatus(
        `${actionConfig.popupLabel}: ${formatNumber(processedCount)} | Confirming ${normalizedText(confirmButton)}`,
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
          console.warn(
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
        console.warn("Marketplace confirmation did not close after retry.");
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

    try {
      const stored = await chrome.storage.local.get(["trialsFast"]);
      await chrome.storage.local.set({
        trialsFast: (stored.trialsFast || 0) + 1,
      });
    } catch (err) {
      console.debug("Could not update trialsFast:", err);
    }

    await actionDelay();

    if (skipLabels) {
      skipLabels.add(title);
    }

    return { status: "done", threadLabel: title };
  }

  async function performOneThreadAction(actionConfig, skipLabels) {
    const buttons = getThreadMenuButtons(skipLabels);
    const target = buttons[0];

    if (!target) {
      if (activeMode === "deleteBuySell") {
        const marketplaceResult =
          await performCurrentMarketplaceConversationDelete(actionConfig, skipLabels);
        if (marketplaceResult.status !== "empty") return marketplaceResult;
      }

      return { status: "empty" };
    }

    const threadLabel = target.label || "Unknown thread";
    console.log(`Opening thread menu: ${threadLabel}`);
    showStatus(
      `${actionConfig.popupLabel}: ${formatNumber(processedCount)} | Opening ${threadLabel.replace(/^More options for\s*/i, "")}`,
    );

    const menuOpened = await openThreadMenu(target.el);
    if (!menuOpened) {
      console.warn("Could not open menu for:", threadLabel);
      skipLabels.add(threadLabel);
      pressEscape();
      await sleep(300);
      return { status: "skipped", reason: "menu_not_opened", threadLabel };
    }

    const actionItem = await waitFor(
      () => findActionMenuItem(actionConfig),
      4000,
      100,
    );
    if (!actionItem) {
      console.warn(
        `${actionConfig.label} menu item not found for:`,
        threadLabel,
      );
      skipLabels.add(threadLabel);
      pressEscape();
      await sleep(300);
      return { status: "skipped", reason: "menu_item_missing", threadLabel };
    }

    if (dryRunActive) {
      announceDryRun(
        `Found thread: ${threadLabel.replace(/^More options for\s*/i, "")}. Found menu action: ${normalizedText(actionItem) || actionConfig.label}. Would stop before selecting it.`,
      );
      // Selecting an action may become stateful in a future Messenger UI, so
      // dry-run deliberately does not open a destructive confirmation dialog.
      return dryRunResult(threadLabel, "dry_run_action_not_selected");
    }

    console.log(
      `Clicking ${actionConfig.label} item:`,
      normalizedText(actionItem),
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
        console.warn(
          `Confirm button not found for ${actionConfig.label}:`,
          threadLabel,
        );
        skipLabels.add(threadLabel);
        pressEscape();
        await sleep(300);
        return { status: "skipped", reason: "confirm_missing", threadLabel };
      }

      showStatus(
        `${actionConfig.popupLabel}: ${formatNumber(processedCount)} | Confirming ${normalizedText(confirmButton)}`,
      );
      console.log(
        `Confirming ${actionConfig.label}:`,
        normalizedText(confirmButton),
      );
      realClick(confirmButton);

      const closed = await waitFor(
        () => !confirmationStillOpen(actionConfig),
        3500,
        150,
      );

      if (!closed) {
        console.warn(
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
        console.warn(
          `Confirmation did not close for ${actionConfig.label}:`,
          threadLabel,
        );
        skipLabels.add(threadLabel);
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

    try {
      const stored = await chrome.storage.local.get(["trialsFast"]);
      await chrome.storage.local.set({
        trialsFast: (stored.trialsFast || 0) + 1,
      });
    } catch (err) {
      console.debug("Could not update trialsFast:", err);
    }

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
    // The fixture can opt into an explicit test limit. A real page gets a
    // conservative one-action ceiling unless the caller explicitly supplies
    // a smaller/larger development limit.
    maxActions = Number.isFinite(Number(options.maxActions))
      ? Math.max(1, Number(options.maxActions))
      : isFixturePage()
        ? Infinity
        : 1;
    processedCount = 0;
    const skippedLabels = new Set();

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
      } else if (mode === "delete" || mode === "archive") {
        if (isMarketplaceFolder() || isMarketplaceDetailView() || isArchivedFolder()) {
          showStatus("Opening regular messages...");
          await openInboxMessages();
          await sleep(500);
        }
      }

      while (shouldRun) {
        const result = await performOneThreadAction(
          actionConfig,
          skippedLabels,
        );

        if (result.status === "empty") {
          console.log(actionConfig.emptyMessage);
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

        if (result.status === "skipped") {
          send("automationWarning", {
            mode,
            count: processedCount,
            reason: result.reason,
            threadLabel: result.threadLabel,
          });

          if (
            skippedLabels.size >= Math.max(1, getThreadMenuButtons().length)
          ) {
            console.warn("All visible thread menus were skipped; stopping.");
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
          send(actionConfig.completeAction, {
            mode,
            count: processedCount,
            message: `Safety limit reached after ${processedCount} action(s).`,
          });
        }
      }
    } catch (err) {
      console.error(`${actionConfig.label} loop failed:`, err);
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
    return (
      visibleElements('a[href*="/marketplace/"]').some(isVisible) ||
      visibleElements('h1, h2, [role="heading"]').some((el) =>
        /Marketplace/i.test(normalizedText(el)),
      )
    );
  }

  function isArchivedFolder() {
    if (isFixturePage()) {
      return (
        document.querySelector("#fixture-status")?.textContent?.includes("Archived") ||
        false
      );
    }
    return visibleElements('h1, h2, [role="heading"]').some((el) =>
      /Archived chats/i.test(normalizedText(el)),
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
      console.log("Navigating back to regular chats/inbox:", candidate);
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
        console.warn("Marketplace messages entry not found.");
        send("noBuySell");
        return;
      }

      console.log("Opening Marketplace messages:", normalizedText(candidate));
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
      send("noArchivedMsgs", { message: "Open Facebook Messages first." });
      return;
    }

    try {
      const settings = await waitFor(
        () => findVisible(SELECTORS.settingsButton),
        5000,
        100,
      );
      if (!settings) {
        console.warn("Settings, help and more button not found.");
        send("noArchivedMsgs", { message: "Settings menu not found." });
        return;
      }

      console.log("Opening settings menu");
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
        console.warn("Archived chats menu item not found.");
        send("noArchivedMsgs", {
          message: "Archived chats menu item not found.",
        });
        pressEscape();
        return;
      }

      console.log("Opening Archived chats:", normalizedText(archivedItem));
      realClick(archivedItem);
      await sleep(800);
      send("loadedCompleteArchived");
    } catch (err) {
      console.error("Could not open Archived chats:", err);
      send("noArchivedMsgs", {
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

    console.table(snapshot.buttons);
    console.log("FBChats Cleaner selector snapshot:", snapshot);
    return snapshot;
  }

  // Expose only a small debug surface in the isolated content-script world.
  window.FBChatsCleanerDebug = {
    selectors: SELECTORS,
    snapshot: getDebugSnapshot,
    stop: stopAutomation,
    isFixturePage,
    isBusy: () => busy,
  };
})();
