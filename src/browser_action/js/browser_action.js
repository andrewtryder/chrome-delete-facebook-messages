/**
 * Delete Facebook Messages — Modern Open-Source Browser Action
 * Clean vanilla JavaScript controller for extension popup.
 */
"use strict";

// =============================================================================
// Pure Helper Functions (testable via node:test)
// =============================================================================

function checkUrl(url) {
  return (
    /facebook\.com\/(messages|latest\/inbox)/i.test(url || "") ||
    /messenger\.com/i.test(url || "") ||
    /(?:127\.0\.0\.1|localhost):4173/i.test(url || "") ||
    /(?:127\.0\.0\.1|localhost):\d+\/test\/mock-messenger/i.test(url || "")
  );
}

function getOperationRuntimeAction(operation) {
  switch (operation) {
    case "delete":
      return "deleteMsgs";
    case "deleteBuySell":
      return "deleteBuySell";
    case "archive":
      return "archiveMsgs";
    case "unarchive":
      return "openArchivedMsgs"; // starts with opening archived view
    default:
      return "deleteMsgs";
  }
}

function getOperationName(operation) {
  switch (operation) {
    case "delete":
      return "Delete regular conversations";
    case "deleteBuySell":
      return "Delete Marketplace conversations";
    case "archive":
      return "Archive regular conversations";
    case "unarchive":
      return "Restore archived conversations";
    default:
      return "Conversations";
  }
}

function mapModeToOperation(mode) {
  switch (mode) {
    case "delete":
      return "delete";
    case "archive":
      return "archive";
    case "deleteBuySell":
      return "deleteBuySell";
    case "unarchive":
      return "unarchive";
    default:
      return "delete";
  }
}

function getProcessedLabel(operation) {
  switch (operation) {
    case "archive":
      return "Archived";
    case "unarchive":
      return "Restored";
    case "delete":
    case "deleteBuySell":
    default:
      return "Deleted";
  }
}

function getCtaLabel({ operation, dryRun }) {
  if (dryRun) {
    switch (operation) {
      case "delete":
        return "Preview deletion";
      case "deleteBuySell":
        return "Preview Marketplace deletion";
      case "archive":
        return "Preview archiving";
      case "unarchive":
        return "Preview restoring";
      default:
        return "Preview operation";
    }
  }

  switch (operation) {
    case "delete":
      return "Start deleting";
    case "deleteBuySell":
      return "Start Marketplace deletion";
    case "archive":
      return "Start archiving";
    case "unarchive":
      return "Restore archived conversations";
    default:
      return "Start operation";
  }
}

function getRunningText({ operation, dryRun }) {
  if (dryRun) {
    return "Previewing conversations…";
  }
  switch (operation) {
    case "delete":
      return "Deleting conversations…";
    case "deleteBuySell":
      return "Deleting Marketplace conversations…";
    case "archive":
      return "Archiving conversations…";
    case "unarchive":
      return "Restoring conversations…";
    default:
      return "Processing conversations…";
  }
}

function migrateTheme(theme, darkMode) {
  if (theme === "light" || theme === "dark" || theme === "system") {
    return theme;
  }
  if (darkMode === true) {
    return "dark";
  }
  return "system";
}

function validateMaxActions(val) {
  const parsed = parseInt(val, 10);
  if (isNaN(parsed) || parsed < 1) return 1;
  if (parsed > 10000) return 10000;
  return parsed;
}

function sanitizeActivity(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    action: String(raw.action || "Unknown action").slice(0, 100),
    result: String(raw.result || "Finished").slice(0, 100),
    processed: Number.isFinite(raw.processed) ? Math.max(0, Math.floor(raw.processed)) : 0,
    inspected: Number.isFinite(raw.inspected) ? Math.max(0, Math.floor(raw.inspected)) : 0,
    skipped: Number.isFinite(raw.skipped) ? Math.max(0, Math.floor(raw.skipped)) : 0,
    errors: Number.isFinite(raw.errors) ? Math.max(0, Math.floor(raw.errors)) : 0,
    timestamp: String(raw.timestamp || new Date().toLocaleString()).slice(0, 50),
  };
}

function normalizePreferences(stored = {}) {
  const theme = migrateTheme(stored.theme, stored.darkMode);
  const defaultDryRun = stored.defaultDryRun !== undefined
    ? Boolean(stored.defaultDryRun)
    : Boolean(stored.dryRun);
  const defaultLimitEnabled = stored.defaultLimitEnabled !== undefined
    ? Boolean(stored.defaultLimitEnabled)
    : Boolean(stored.limitEnabled);
  const defaultMaxActions = validateMaxActions(
    stored.defaultMaxActions !== undefined
      ? stored.defaultMaxActions
      : (stored.maxActions !== undefined ? stored.maxActions : 10),
  );
  const defaultSpeedLevel = ["slow", "normal", "fast", "veryfast", "ultra"].includes(stored.defaultSpeedLevel)
    ? stored.defaultSpeedLevel
    : (["slow", "normal", "fast", "veryfast", "ultra"].includes(stored.speedLevel)
        ? stored.speedLevel
        : "fast");

  return {
    theme,
    dryRun: defaultDryRun,
    limitEnabled: defaultLimitEnabled,
    maxActions: defaultMaxActions,
    speedLevel: defaultSpeedLevel,
    defaultDryRun,
    defaultLimitEnabled,
    defaultMaxActions,
    defaultSpeedLevel,
    lastActivity: sanitizeActivity(stored.lastActivity || stored.recentActivity),
  };
}

// =============================================================================
// Browser Action UI State & Controller
// =============================================================================

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const state = {
    pageStatus: "checking", // "ready" | "unavailable" | "checking"
    activeTabId: null,
    activeTabUrl: "",

    view: "main", // "main" | "settings"
    settingsTab: "settings", // "settings" | "activity" | "about"

    operation: "delete",
    dryRun: false,

    limitEnabled: false,
    maxActions: 10,

    speedLevel: "fast",
    theme: "system",

    defaultDryRun: false,
    defaultLimitEnabled: false,
    defaultMaxActions: 10,
    defaultSpeedLevel: "fast",

    running: false,
    stopping: false,
    pendingUnarchiveAll: false,

    processed: 0,
    inspected: 0,
    skipped: 0,
    errors: 0,

    lastActivity: null,
  };

  // DOM Elements
  let els = {};

  function initElements() {
    els = {
      // Views
      viewMain: document.getElementById("view-main"),
      viewSettings: document.getElementById("view-settings"),
      btnSettings: document.getElementById("btn-settings"),
      btnBack: document.getElementById("btn-back"),

      // Notification Banner
      notificationBanner: document.getElementById("notification-banner"),
      notificationText: document.getElementById("notification-text"),
      notificationDismiss: document.getElementById("notification-dismiss"),

      // Status
      statusDot: document.getElementById("status-dot"),
      statusHeading: document.getElementById("status-heading"),
      statusDesc: document.getElementById("status-desc"),
      btnRefresh: document.getElementById("btn-refresh"),
      btnOpenMessenger: document.getElementById("btn-open-messenger"),

      // Notice
      safetyNoticeCard: document.getElementById("safety-notice-card"),
      safetyNoticeTitle: document.getElementById("safety-notice-title"),
      safetyNoticeBody: document.getElementById("safety-notice-body"),

      // Operations
      operationRadios: document.querySelectorAll('input[name="operation"]'),
      radioCards: document.querySelectorAll(".radio-card"),

      // Safety
      dryRunToggle: document.getElementById("dry-run-toggle"),
      limitToggle: document.getElementById("limit-toggle"),
      limitInputWrap: document.getElementById("limit-input-wrap"),
      maxActionsInput: document.getElementById("max-actions-input"),

      // Advanced
      advancedDetails: document.getElementById("advanced-details"),
      speedSelect: document.getElementById("speed-select"),

      // CTA & Running
      btnMainCta: document.getElementById("btn-main-cta"),
      runningCard: document.getElementById("running-card"),
      runningText: document.getElementById("running-text"),
      btnStop: document.getElementById("btn-stop"),

      // Metrics
      metricProcessedVal: document.getElementById("metric-processed-val"),
      metricProcessedLabel: document.getElementById("metric-processed-label"),
      metricInspectedVal: document.getElementById("metric-inspected-val"),
      metricSkippedVal: document.getElementById("metric-skipped-val"),
      metricErrorsVal: document.getElementById("metric-errors-val"),

      // Footer
      footerVersion: document.getElementById("footer-version"),

      // Modal
      confirmModal: document.getElementById("confirm-modal"),
      modalTitle: document.getElementById("modal-title"),
      modalBody: document.getElementById("modal-body"),
      btnModalCancel: document.getElementById("btn-modal-cancel"),
      btnModalConfirm: document.getElementById("btn-modal-confirm"),

      // Settings Tabs
      tabSettings: document.getElementById("tab-settings"),
      tabActivity: document.getElementById("tab-activity"),
      tabAbout: document.getElementById("tab-about"),
      panelSettings: document.getElementById("panel-settings"),
      panelActivity: document.getElementById("panel-activity"),
      panelAbout: document.getElementById("panel-about"),

      // Settings Controls
      settingDefaultDryRun: document.getElementById("setting-default-dry-run"),
      settingDefaultLimit: document.getElementById("setting-default-limit"),
      settingDefaultLimitWrap: document.getElementById("setting-default-limit-wrap"),
      settingDefaultLimitVal: document.getElementById("setting-default-limit-val"),
      settingDefaultSpeed: document.getElementById("setting-default-speed"),
      themeSelect: document.getElementById("theme-select"),
      btnResetActivity: document.getElementById("btn-reset-activity"),
      btnResetSettings: document.getElementById("btn-reset-settings"),

      // Activity Controls
      activityContent: document.getElementById("activity-content"),
      emptyActivity: document.getElementById("empty-activity"),
      activityDetails: document.getElementById("activity-details"),
      actAction: document.getElementById("act-action"),
      actResult: document.getElementById("act-result"),
      actProcessed: document.getElementById("act-processed"),
      actInspected: document.getElementById("act-inspected"),
      actSkipped: document.getElementById("act-skipped"),
      actErrors: document.getElementById("act-errors"),
      actTime: document.getElementById("act-time"),
      btnClearActivity: document.getElementById("btn-clear-activity"),

      // About
      aboutVersion: document.getElementById("about-version"),
    };
  }

  // ---------------------------------------------------------------------------
  // Theme Management
  // ---------------------------------------------------------------------------
  function applyTheme(theme) {
    state.theme = theme;
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------
  let notificationTimer = null;

  function showNotification(message, type = "info") {
    if (!els.notificationBanner) return;
    clearTimeout(notificationTimer);

    els.notificationText.textContent = message;
    els.notificationBanner.className = `notification-banner ${type}`;

    notificationTimer = setTimeout(() => {
      dismissNotification();
    }, 4000);
  }

  function dismissNotification() {
    clearTimeout(notificationTimer);
    if (els.notificationBanner) {
      els.notificationBanner.className = "notification-banner hidden";
    }
  }

  // ---------------------------------------------------------------------------
  // Status & Tab Check
  // ---------------------------------------------------------------------------
  function findMessengerTab(callback) {
    if (typeof chrome === "undefined" || !chrome.tabs) {
      callback(null);
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const active = tabs && tabs[0];
      if (active && checkUrl(active.url)) {
        callback(active);
        return;
      }

      // If popup is opened in a standalone extension tab or iframe, check all tabs
      chrome.tabs.query({}, (allTabs) => {
        const found = (allTabs || []).find((t) => t.url && checkUrl(t.url));
        callback(found || active || null);
      });
    });
  }

  function checkActiveTab() {
    updatePageStatus("checking");

    findMessengerTab((tab) => {
      if (tab && tab.url && checkUrl(tab.url)) {
        state.activeTabId = tab.id;
        state.activeTabUrl = tab.url;
        updatePageStatus("ready");
        rehydrateAutomationState();
      } else {
        state.activeTabId = tab ? tab.id : null;
        state.activeTabUrl = tab ? tab.url : "";
        updatePageStatus("unavailable");
      }
    });
  }

  function updatePageStatus(status) {
    state.pageStatus = status;

    if (!els.statusDot) return;

    els.statusDot.className = `status-dot ${status}`;

    if (status === "ready") {
      els.statusHeading.textContent = "Ready";
      els.statusDesc.textContent = "Messenger detected on this page";
      els.btnOpenMessenger.classList.add("hidden");
      els.btnMainCta.disabled = state.running;
    } else if (status === "unavailable") {
      els.statusHeading.textContent = "Messenger not detected";
      els.statusDesc.textContent = "Open Facebook Messenger to use conversation actions.";
      els.btnOpenMessenger.classList.remove("hidden");
      els.btnMainCta.disabled = true;
    } else {
      els.statusHeading.textContent = "Checking current tab…";
      els.statusDesc.textContent = "Examining the active browser tab for Messenger.";
      els.btnOpenMessenger.classList.add("hidden");
      els.btnMainCta.disabled = true;
    }
  }

  function openMessengerPage() {
    findMessengerTab((existing) => {
      if (existing && existing.id) {
        chrome.tabs.update(existing.id, { active: true });
        if (existing.windowId) {
          chrome.windows.update(existing.windowId, { focused: true });
        }
        setTimeout(checkActiveTab, 600);
      } else {
        chrome.tabs.create({ url: "https://www.facebook.com/messages/" });
        setTimeout(checkActiveTab, 1000);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // UI Render Updates
  // ---------------------------------------------------------------------------
  function updateSafetyNotice() {
    if (!els.safetyNoticeCard) return;

    if (state.operation === "delete" || state.operation === "deleteBuySell") {
      els.safetyNoticeTitle.textContent = "Deletion is permanent";
      els.safetyNoticeBody.textContent =
        "Deleted conversations cannot be restored by this extension. Use Dry run to preview what would be selected before making changes.";
      els.safetyNoticeCard.style.borderColor = "rgba(37, 99, 235, 0.2)";
      els.safetyNoticeCard.style.background = "var(--primary-soft)";
    } else if (state.operation === "archive") {
      els.safetyNoticeTitle.textContent = "Archiving conversations";
      els.safetyNoticeBody.textContent =
        "Archiving moves conversations to Archived chats. They can be restored to your inbox at any time.";
      els.safetyNoticeCard.style.borderColor = "rgba(22, 163, 74, 0.2)";
      els.safetyNoticeCard.style.background = "var(--success-soft)";
    } else if (state.operation === "unarchive") {
      els.safetyNoticeTitle.textContent = "Restoring conversations";
      els.safetyNoticeBody.textContent =
        "Restoring moves conversations from Archived chats back into your active inbox.";
      els.safetyNoticeCard.style.borderColor = "rgba(22, 163, 74, 0.2)";
      els.safetyNoticeCard.style.background = "var(--success-soft)";
    }
  }

  function updateCtaButton() {
    if (!els.btnMainCta) return;
    els.btnMainCta.textContent = getCtaLabel({
      operation: state.operation,
      dryRun: state.dryRun,
    });
    els.metricProcessedLabel.textContent = getProcessedLabel(state.operation);
  }

  function renderRunningState() {
    if (state.running) {
      els.btnMainCta.classList.add("hidden");
      els.runningCard.classList.remove("hidden");
      els.runningText.textContent = state.stopping
        ? "Stopping after the current action…"
        : getRunningText({ operation: state.operation, dryRun: state.dryRun });

      els.btnStop.disabled = state.stopping;

      // Disable inputs while running
      els.operationRadios.forEach((r) => (r.disabled = true));
      els.dryRunToggle.disabled = true;
      els.limitToggle.disabled = true;
      els.maxActionsInput.disabled = true;
      els.speedSelect.disabled = true;
    } else {
      els.btnMainCta.classList.remove("hidden");
      els.runningCard.classList.add("hidden");
      els.btnMainCta.disabled = state.pageStatus !== "ready";

      // Re-enable inputs
      els.operationRadios.forEach((r) => (r.disabled = false));
      els.dryRunToggle.disabled = false;
      els.limitToggle.disabled = false;
      els.maxActionsInput.disabled = false;
      els.speedSelect.disabled = false;
    }
  }

  function renderMetrics() {
    if (!els.metricProcessedVal) return;
    els.metricProcessedVal.textContent = String(state.processed);
    els.metricInspectedVal.textContent = String(state.inspected);
    els.metricSkippedVal.textContent = String(state.skipped);
    els.metricErrorsVal.textContent = String(state.errors);
  }

  function renderActivityView() {
    if (!els.activityContent) return;
    const act = state.lastActivity;
    if (!act) {
      els.emptyActivity.classList.remove("hidden");
      els.activityDetails.classList.add("hidden");
    } else {
      els.emptyActivity.classList.add("hidden");
      els.activityDetails.classList.remove("hidden");
      els.actAction.textContent = act.action;
      els.actResult.textContent = act.result;
      els.actProcessed.textContent = String(act.processed);
      els.actInspected.textContent = String(act.inspected);
      els.actSkipped.textContent = String(act.skipped);
      els.actErrors.textContent = String(act.errors);
      els.actTime.textContent = act.timestamp;
    }
  }

  // ---------------------------------------------------------------------------
  // Navigation & Tabs
  // ---------------------------------------------------------------------------
  function switchView(viewName) {
    state.view = viewName;
    if (viewName === "settings") {
      els.viewMain.classList.add("hidden");
      els.viewSettings.classList.remove("hidden");
      renderActivityView();
    } else {
      els.viewSettings.classList.add("hidden");
      els.viewMain.classList.remove("hidden");
      checkActiveTab();
    }
  }

  function switchSettingsTab(tabName) {
    state.settingsTab = tabName;

    els.tabSettings.classList.toggle("active", tabName === "settings");
    els.tabSettings.setAttribute("aria-selected", String(tabName === "settings"));

    els.tabActivity.classList.toggle("active", tabName === "activity");
    els.tabActivity.setAttribute("aria-selected", String(tabName === "activity"));

    els.tabAbout.classList.toggle("active", tabName === "about");
    els.tabAbout.setAttribute("aria-selected", String(tabName === "about"));

    els.panelSettings.classList.toggle("hidden", tabName !== "settings");
    els.panelActivity.classList.toggle("hidden", tabName !== "activity");
    els.panelAbout.classList.toggle("hidden", tabName !== "about");

    if (tabName === "activity") {
      renderActivityView();
    }
  }

  // ---------------------------------------------------------------------------
  // Action Execution & Confirmation
  // ---------------------------------------------------------------------------
  function handleMainCtaClick() {
    if (state.running) return;

    // If dryRun is OFF and operation is destructive delete: require confirmation modal
    if (!state.dryRun && (state.operation === "delete" || state.operation === "deleteBuySell")) {
      openConfirmModal();
      return;
    }

    startOperation();
  }

  let previousFocusedElement = null;

  function openConfirmModal() {
    previousFocusedElement = document.activeElement;
    if (state.operation === "deleteBuySell") {
      els.modalTitle.textContent = "Delete Marketplace conversations?";
      els.btnModalConfirm.textContent = "Delete Marketplace conversations";
    } else {
      els.modalTitle.textContent = "Delete conversations?";
      els.btnModalConfirm.textContent = "Delete conversations";
    }
    els.confirmModal.classList.remove("hidden");
    if (els.btnModalCancel) {
      els.btnModalCancel.focus();
    }
  }

  function closeConfirmModal() {
    if (els.confirmModal) {
      els.confirmModal.classList.add("hidden");
    }
    if (previousFocusedElement && typeof previousFocusedElement.focus === "function") {
      previousFocusedElement.focus();
      previousFocusedElement = null;
    }
  }

  function handleModalKeydown(e) {
    if (!els.confirmModal || els.confirmModal.classList.contains("hidden")) return;

    if (e.key === "Escape") {
      e.preventDefault();
      closeConfirmModal();
      return;
    }

    if (e.key === "Tab") {
      const focusable = [els.btnModalCancel, els.btnModalConfirm].filter(Boolean);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }
  document.addEventListener("keydown", handleModalKeydown);

  function startOperation() {
    closeConfirmModal();

    if (state.pageStatus !== "ready" || !state.activeTabId) {
      showNotification("No active Messenger tab found.", "error");
      return;
    }

    state.running = true;
    state.stopping = false;
    state.processed = 0;
    state.inspected = 0;
    state.skipped = 0;
    state.errors = 0;
    renderMetrics();
    renderRunningState();

    const options = {
      dryRun: state.dryRun,
    };
    if (state.limitEnabled && state.maxActions > 0) {
      options.maxActions = state.maxActions;
    }

    // Save current active speed
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ speedLevel: state.speedLevel });
    }

    // If restore (unarchive), first open archived messages
    if (state.operation === "unarchive") {
      state.pendingUnarchiveAll = true;
      sendToActiveTab("openArchivedMsgs", options);
      return;
    }

    const action = getOperationRuntimeAction(state.operation);
    sendToActiveTab(action, options);
  }

  function stopOperation() {
    if (!state.running || state.stopping) return;
    state.stopping = true;
    renderRunningState();
    showNotification("Stopping after the current action…", "info");
    sendToActiveTab("stopAutomation", {});
  }

  function rehydrateAutomationState() {
    if (!state.activeTabId || typeof chrome === "undefined" || !chrome.tabs) return;

    chrome.tabs.sendMessage(state.activeTabId, { action: "getAutomationState" }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) return;

      if (res.running) {
        state.running = true;
        state.stopping = Boolean(res.stopping);
        if (res.mode) {
          state.operation = mapModeToOperation(res.mode);
          els.operationRadios.forEach((r) => {
            r.checked = r.value === state.operation;
          });
          els.radioCards.forEach((card) => {
            const radio = card.querySelector('input[type="radio"]');
            card.classList.toggle("active", radio && radio.value === state.operation);
          });
        }
        if (typeof res.dryRun === "boolean") {
          state.dryRun = res.dryRun;
          els.dryRunToggle.checked = res.dryRun;
        }
        state.processed = res.processed || 0;
        state.inspected = res.inspected || 0;
        state.skipped = res.skipped || 0;
        state.errors = res.errors || 0;

        renderRunningState();
        renderMetrics();
        updateSafetyNotice();
        updateCtaButton();
      } else if (state.running) {
        finalizeRun("Completed");
      }
    });
  }

  function sendToActiveTab(action, payload = {}) {
    if (!state.activeTabId) return;

    chrome.tabs.sendMessage(state.activeTabId, { action, ...payload }, (res) => {
      if (chrome.runtime.lastError) {
        state.running = false;
        state.stopping = false;
        renderRunningState();
        showNotification(
          "Content script not reachable. Refresh Facebook Messages and try again.",
          "error",
        );
        return;
      }

      if (res && res.ok === false) {
        if (res.busy) {
          state.running = true;
          showNotification(res.message || "Automation is already active in this tab.", "warning");
          rehydrateAutomationState();
        } else {
          state.running = false;
          state.stopping = false;
          renderRunningState();
          showNotification(res.message || "Operation could not be started.", "error");
        }
      }
    });
  }

  function finalizeRun(resultText) {
    state.running = false;
    state.stopping = false;
    state.pendingUnarchiveAll = false;
    renderRunningState();

    const activity = {
      action: getOperationName(state.operation),
      result: resultText,
      processed: state.processed,
      inspected: state.inspected,
      skipped: state.skipped,
      errors: state.errors,
      timestamp: new Date().toLocaleString(),
    };
    state.lastActivity = activity;

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        lastActivity: activity,
        recentActivity: activity,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Runtime Messaging Listener
  // ---------------------------------------------------------------------------
  function initMessageListener() {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.onMessage) {
      return;
    }

    chrome.runtime.onMessage.addListener((request) => {
      const action = request && request.action;
      if (!action) return;

      switch (action) {
        case "deleteStarted":
        case "archiveStarted":
        case "deleteBuySellStarted":
        case "unarchiveStarted":
          state.running = true;
          renderRunningState();
          break;

        case "deleteProgress":
        case "archiveProgress":
        case "deleteBuySellProgress":
        case "unarchiveProgress":
          state.processed = request.count || (state.processed + 1);
          renderMetrics();
          break;

        case "dryRunProgress":
          state.inspected = request.inspectedCount || (state.inspected + 1);
          renderMetrics();
          break;

        case "loadedCompleteArchived":
          if (state.pendingUnarchiveAll) {
            state.pendingUnarchiveAll = false;
            const options = { dryRun: state.dryRun };
            if (state.limitEnabled && state.maxActions > 0) {
              options.maxActions = state.maxActions;
            }
            sendToActiveTab("unarchiveAll", options);
          }
          break;

        case "noMessagesToDlt":
        case "NoMsgsToArchv":
        case "noBuySellMsgs":
        case "noArchivedMsgs":
        case "loadedComplete":
        case "archivedSuccess":
        case "unarchivedSuccess":
          finalizeRun(request.message || "Completed");
          showNotification(request.message || "Operation completed.", "success");
          break;

        case "automationStopped":
          finalizeRun("Stopped by user");
          showNotification("Process stopped.", "info");
          break;

        case "automationWarning":
          state.skipped += 1;
          renderMetrics();
          if (request.message) {
            showNotification(request.message, "warning");
          }
          break;

        case "automationError":
        case "deleteError":
        case "archiveError":
        case "deleteBuySellError":
        case "unarchiveError":
        case "clickError":
        case "noBuySell":
          state.errors += 1;
          renderMetrics();
          finalizeRun(`Error: ${request.message || "Unknown error"}`);
          showNotification(request.message || "An error occurred.", "error");
          break;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Event Bindings
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // Navigation
    els.btnSettings.addEventListener("click", () => switchView("settings"));
    els.btnBack.addEventListener("click", () => switchView("main"));

    // Notification dismiss
    els.notificationDismiss.addEventListener("click", dismissNotification);

    // Refresh & Open Messenger
    els.btnRefresh.addEventListener("click", checkActiveTab);
    els.btnOpenMessenger.addEventListener("click", openMessengerPage);

    // Operation radio buttons
    els.operationRadios.forEach((radio) => {
      radio.addEventListener("change", (e) => {
        state.operation = e.target.value;
        els.radioCards.forEach((card) => {
          card.classList.toggle("active", card.contains(e.target));
        });
        updateSafetyNotice();
        updateCtaButton();
      });
    });

    // Dry Run Toggle
    els.dryRunToggle.addEventListener("change", (e) => {
      state.dryRun = e.target.checked;
      state.defaultDryRun = state.dryRun;
      if (els.settingDefaultDryRun) els.settingDefaultDryRun.checked = state.dryRun;
      updateCtaButton();
      if (chrome?.storage?.local) {
        chrome.storage.local.set({ dryRun: state.dryRun, defaultDryRun: state.dryRun });
      }
      showNotification(
        state.dryRun ? "Dry run enabled: actions will only be previewed." : "Dry run disabled.",
        "info",
      );
    });

    // Limit Toggle
    els.limitToggle.addEventListener("change", (e) => {
      state.limitEnabled = e.target.checked;
      state.defaultLimitEnabled = state.limitEnabled;
      els.limitInputWrap.classList.toggle("hidden", !state.limitEnabled);
      if (els.settingDefaultLimit) els.settingDefaultLimit.checked = state.limitEnabled;
      if (els.settingDefaultLimitWrap) els.settingDefaultLimitWrap.classList.toggle("hidden", !state.limitEnabled);
      if (chrome?.storage?.local) {
        chrome.storage.local.set({ limitEnabled: state.limitEnabled, defaultLimitEnabled: state.limitEnabled });
      }
    });

    // Max Actions Input
    els.maxActionsInput.addEventListener("input", (e) => {
      state.maxActions = validateMaxActions(e.target.value);
      state.defaultMaxActions = state.maxActions;
      if (els.settingDefaultLimitVal) els.settingDefaultLimitVal.value = state.maxActions;
      if (chrome?.storage?.local) {
        chrome.storage.local.set({ maxActions: state.maxActions, defaultMaxActions: state.maxActions });
      }
    });

    // Delay / Speed Select
    els.speedSelect.addEventListener("change", (e) => {
      state.speedLevel = e.target.value;
      state.defaultSpeedLevel = e.target.value;
      if (els.settingDefaultSpeed) els.settingDefaultSpeed.value = state.speedLevel;
      if (chrome?.storage?.local) {
        chrome.storage.local.set({
          speedLevel: state.speedLevel,
          defaultSpeedLevel: state.defaultSpeedLevel,
        });
      }
      showNotification("Delay setting updated.", "info");
    });

    // CTA & Stop
    els.btnMainCta.addEventListener("click", handleMainCtaClick);
    els.btnStop.addEventListener("click", stopOperation);

    // Modal Sheet
    els.btnModalCancel.addEventListener("click", closeConfirmModal);
    els.btnModalConfirm.addEventListener("click", startOperation);

    // Settings Tabs
    els.tabSettings.addEventListener("click", () => switchSettingsTab("settings"));
    els.tabActivity.addEventListener("click", () => switchSettingsTab("activity"));
    els.tabAbout.addEventListener("click", () => switchSettingsTab("about"));

    // Settings Defaults
    els.settingDefaultDryRun.addEventListener("change", (e) => {
      state.defaultDryRun = e.target.checked;
      state.dryRun = state.defaultDryRun;
      if (els.dryRunToggle) els.dryRunToggle.checked = state.dryRun;
      updateCtaButton();
      chrome?.storage?.local?.set({ dryRun: state.dryRun, defaultDryRun: state.defaultDryRun });
    });

    els.settingDefaultLimit.addEventListener("change", (e) => {
      state.defaultLimitEnabled = e.target.checked;
      state.limitEnabled = state.defaultLimitEnabled;
      if (els.limitToggle) els.limitToggle.checked = state.limitEnabled;
      if (els.limitInputWrap) els.limitInputWrap.classList.toggle("hidden", !state.limitEnabled);
      els.settingDefaultLimitWrap.classList.toggle("hidden", !state.defaultLimitEnabled);
      chrome?.storage?.local?.set({ limitEnabled: state.limitEnabled, defaultLimitEnabled: state.defaultLimitEnabled });
    });

    els.settingDefaultLimitVal.addEventListener("input", (e) => {
      state.defaultMaxActions = validateMaxActions(e.target.value);
      state.maxActions = state.defaultMaxActions;
      if (els.maxActionsInput) els.maxActionsInput.value = state.maxActions;
      chrome?.storage?.local?.set({ maxActions: state.maxActions, defaultMaxActions: state.maxActions });
    });

    els.settingDefaultSpeed.addEventListener("change", (e) => {
      state.defaultSpeedLevel = e.target.value;
      state.speedLevel = state.defaultSpeedLevel;
      if (els.speedSelect) els.speedSelect.value = state.speedLevel;
      chrome?.storage?.local?.set({
        defaultSpeedLevel: state.defaultSpeedLevel,
        speedLevel: state.defaultSpeedLevel,
      });
    });

    // Theme Selector
    els.themeSelect.addEventListener("change", (e) => {
      applyTheme(e.target.value);
      chrome?.storage?.local?.set({ theme: e.target.value });
    });

    // Reset Buttons
    const clearActivityHandler = () => {
      state.lastActivity = null;
      renderActivityView();
      chrome?.storage?.local?.remove(["lastActivity", "recentActivity"]);
      showNotification("Activity history cleared.", "success");
    };
    els.btnResetActivity.addEventListener("click", clearActivityHandler);
    els.btnClearActivity.addEventListener("click", clearActivityHandler);

    els.btnResetSettings.addEventListener("click", () => {
      state.dryRun = false;
      state.limitEnabled = false;
      state.maxActions = 10;
      state.speedLevel = "fast";
      state.theme = "system";
      state.defaultDryRun = false;
      state.defaultLimitEnabled = false;
      state.defaultMaxActions = 10;
      state.defaultSpeedLevel = "fast";

      applyTheme("system");
      syncStateToDom();

      chrome?.storage?.local?.remove([
        "dryRun",
        "limitEnabled",
        "maxActions",
      ]);
      chrome?.storage?.local?.set({
        speedLevel: "fast",
        theme: "system",
        defaultDryRun: false,
        defaultLimitEnabled: false,
        defaultMaxActions: 10,
        defaultSpeedLevel: "fast",
      });

      showNotification("Settings reset to defaults.", "success");
    });
  }

  function syncStateToDom() {
    els.dryRunToggle.checked = state.dryRun;
    els.limitToggle.checked = state.limitEnabled;
    els.limitInputWrap.classList.toggle("hidden", !state.limitEnabled);
    els.maxActionsInput.value = state.maxActions;
    els.speedSelect.value = state.speedLevel;

    els.settingDefaultDryRun.checked = state.defaultDryRun;
    els.settingDefaultLimit.checked = state.defaultLimitEnabled;
    els.settingDefaultLimitWrap.classList.toggle("hidden", !state.defaultLimitEnabled);
    els.settingDefaultLimitVal.value = state.defaultMaxActions;
    els.settingDefaultSpeed.value = state.defaultSpeedLevel;
    els.themeSelect.value = state.theme;

    updateSafetyNotice();
    updateCtaButton();
    renderMetrics();
    renderRunningState();
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    initElements();

    // Set manifest version dynamically in footer and about
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest) {
      const manifest = chrome.runtime.getManifest();
      const ver = manifest.version || "3.8.0";
      if (els.footerVersion) els.footerVersion.textContent = `v${ver}`;
      if (els.aboutVersion) els.aboutVersion.textContent = `Version ${ver}`;
    }

    // Load saved preferences
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(null, (stored) => {
        const prefs = normalizePreferences(stored || {});
        Object.assign(state, prefs);
        applyTheme(state.theme);
        syncStateToDom();
        checkActiveTab();
      });
    } else {
      applyTheme(state.theme);
      syncStateToDom();
      checkActiveTab();
    }

    bindEvents();
    initMessageListener();
  });
}

// Export for unit tests
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    checkUrl,
    getOperationRuntimeAction,
    getOperationName,
    getProcessedLabel,
    getCtaLabel,
    getRunningText,
    migrateTheme,
    validateMaxActions,
    sanitizeActivity,
    normalizePreferences,
    mapModeToOperation,
  };
}
