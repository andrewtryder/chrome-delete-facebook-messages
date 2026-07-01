console.log("🚀 FBChats Cleaner - browser_action.js loaded");
console.log("Current URL:", window.location.href);

var app = angular.module("myapp", []);

app.controller("ctrl", function ($scope) {
  console.log("✅ Angular popup controller started");

  // ---------------------------------------------------------------------------
  // Scope defaults
  // ---------------------------------------------------------------------------
  $scope.notOnFB = true;
  $scope.onFB = false;
  $scope.loadingMPage = false;

  // Preserve your existing unlocked popup behavior.
  $scope.license = true;
  $scope.trialsLimitComplete = false;
  $scope.trialsFast = 999999;

  $scope.deleteProcess = false;
  $scope.archiveProcess = false;
  $scope.BuySellLoadingWait = false;
  $scope.archivedLoadingWait = false;
  $scope.buySell = false;
  $scope.unarchive = false;
  $scope.BuySellOpenNow = false;
  $scope.archivedOpenNow = false;
  $scope.darkMode = false;
  $scope.lastProgress = "";

  $scope.speeds = [
    { id: "slow", name: "Slow", icon: "🐢", locked: false },
    { id: "normal", name: "Normal", icon: "🚶", locked: false },
    { id: "fast", name: "Fast", icon: "⚡", locked: false },
    { id: "veryfast", name: "Very Fast", icon: "🚀", locked: false },
    { id: "ultra", name: "Ultra", icon: "🔥", locked: false },
  ];

  $scope.selectedSpeed = "fast";

  toastr.options = {
    closeButton: true,
    debug: false,
    newestOnTop: false,
    progressBar: true,
    positionClass: "toast-top-right",
    preventDuplicates: false,
    onclick: null,
    showDuration: "300",
    hideDuration: "1000",
    timeOut: "10000",
    extendedTimeOut: "1000",
    showEasing: "swing",
    hideEasing: "linear",
    showMethod: "fadeIn",
    hideMethod: "fadeOut",
  };

  function safeApply(fn) {
    if ($scope.$$phase || ($scope.$root && $scope.$root.$$phase)) {
      fn();
    } else {
      $scope.$apply(fn);
    }
  }

  function activeTab(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      callback(tabs && tabs[0] ? tabs[0] : null);
    });
  }

  function sendToActiveTab(action, payload) {
    activeTab(function (tab) {
      if (!tab || !tab.id) {
        safeApply(function () {
          resetProcessingFlags();
          toastr.error("No active tab found.", "Error");
        });
        return;
      }

      chrome.tabs.sendMessage(
        tab.id,
        Object.assign({ action: action }, payload || {}),
        function (response) {
          if (chrome.runtime.lastError) {
            safeApply(function () {
              resetProcessingFlags();
              toastr.error(
                "Content script is not available on this tab. Reload Facebook Messages and try again.",
                "Extension not injected",
              );
            });
            return;
          }

          if (response && response.ok === false) {
            safeApply(function () {
              resetProcessingFlags();
              toastr.warning(
                response.message ||
                  "Action was not accepted by the content script.",
              );
            });
          }
        },
      );
    });
  }

  function resetProcessingFlags() {
    $scope.deleteProcess = false;
    $scope.archiveProcess = false;
    $scope.BuySellLoadingWait = false;
    $scope.archivedLoadingWait = false;
    $scope.buySell = false;
    $scope.unarchive = false;
  }

  function markStarted(mode) {
    if (mode === "delete") $scope.deleteProcess = true;
    if (mode === "archive") $scope.archiveProcess = true;
    if (mode === "deleteBuySell") $scope.buySell = true;
    if (mode === "unarchive") $scope.unarchive = true;
  }

  function markComplete(mode) {
    if (mode === "delete") $scope.deleteProcess = false;
    if (mode === "archive") $scope.archiveProcess = false;
    if (mode === "deleteBuySell") $scope.buySell = false;
    if (mode === "unarchive") $scope.unarchive = false;
  }

  // ---------------------------------------------------------------------------
  // Theme and speed settings
  // ---------------------------------------------------------------------------
  chrome.storage.local.get(
    ["darkMode", "speedLevel", "trialsFast", "license_key"],
    function (result) {
      safeApply(function () {
        $scope.darkMode = !!result.darkMode;
        $scope.selectedSpeed = result.speedLevel || "fast";
        $scope.trialsFast =
          typeof result.trialsFast === "number" ? result.trialsFast : 999999;
        $scope.license = true;
        $scope.trialsLimitComplete = false;
      });
    },
  );

  $scope.toggleTheme = function () {
    $scope.darkMode = !$scope.darkMode;
    chrome.storage.local.set({ darkMode: $scope.darkMode });
  };

  $scope.getSpeedLabel = function (id) {
    var match = $scope.speeds.filter(function (speed) {
      return speed.id === id;
    })[0];
    return match ? match.name : "Fast";
  };

  $scope.setSpeed = function (speed) {
    if (!speed || !speed.id) return;

    $scope.selectedSpeed = speed.id;
    chrome.storage.local.set({ speedLevel: speed.id });
    toastr.clear();
    toastr.success("Speed set to " + speed.name, "Updated");
  };

  // ---------------------------------------------------------------------------
  // Page detection/navigation
  // ---------------------------------------------------------------------------
  $scope.checkUrl = function (url) {
    return (
      /facebook\.com\/(messages|latest\/inbox)/i.test(url || "") ||
      /messenger\.com/i.test(url || "")
    );
  };

  $scope.goToFBP = function () {
    $scope.loadingMPage = true;

    chrome.tabs.query({}, function (tabs) {
      var existingTab = (tabs || []).find(function (tab) {
        return tab.url && $scope.checkUrl(tab.url);
      });

      if (existingTab) {
        chrome.tabs.reload(existingTab.id, function () {
          chrome.tabs.update(existingTab.id, { active: true });
          chrome.windows.update(existingTab.windowId, { focused: true });
        });
      } else {
        chrome.tabs.create({ url: "https://www.facebook.com/messages/" });
      }

      setTimeout($scope.checkActivePage, 700);
    });
  };

  $scope.checkActivePage = function () {
    activeTab(function (tab) {
      safeApply(function () {
        if (tab && tab.url && $scope.checkUrl(tab.url)) {
          $scope.notOnFB = false;
          $scope.onFB = true;
        } else {
          $scope.notOnFB = true;
          $scope.onFB = false;
        }
        $scope.loadingMPage = false;
      });
    });
  };

  $scope.updatePGscope = function (notOnFBP, onFBP, loadingMPage) {
    safeApply(function () {
      $scope.notOnFB = notOnFBP;
      $scope.onFB = onFBP;
      $scope.loadingMPage = loadingMPage;
    });
  };

  // ---------------------------------------------------------------------------
  // Popup actions
  // ---------------------------------------------------------------------------
  $scope.archvMsgs = function () {
    resetProcessingFlags();
    $scope.archiveProcess = true;
    sendToActiveTab("archiveMsgs");
  };

  $scope.deleteMsgs = function () {
    resetProcessingFlags();
    $scope.deleteProcess = true;
    sendToActiveTab("deleteMsgs");
  };

  $scope.openBuySell = function () {
    resetProcessingFlags();
    $scope.BuySellLoadingWait = true;
    $scope.BuySellOpenNow = false;
    sendToActiveTab("BuySell");
  };

  $scope.deleteBuySell = function () {
    $scope.buySell = true;
    sendToActiveTab("deleteBuySell");
  };

  $scope.openArchivedMsgs = function () {
    resetProcessingFlags();
    $scope.archivedLoadingWait = true;
    $scope.archivedOpenNow = false;
    sendToActiveTab("openArchivedMsgs");
  };

  $scope.unarchiveAll = function () {
    $scope.unarchive = true;
    sendToActiveTab("unarchiveAll");
  };

  $scope.stopAutomation = function () {
    sendToActiveTab("stopAutomation");
    resetProcessingFlags();
    toastr.info("Stopping after the current action.");
  };

  $scope.debugSelectors = function () {
    sendToActiveTab("debugSelectors");
  };

  // ---------------------------------------------------------------------------
  // Runtime messages from content script
  // ---------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener(function (request) {
    if (!request || !request.action) return;

    safeApply(function () {
      switch (request.action) {
        case "deleteStarted":
          markStarted("delete");
          toastr.info("Delete process started.");
          break;

        case "archiveStarted":
          markStarted("archive");
          toastr.info("Archive process started.");
          break;

        case "deleteBuySellStarted":
          markStarted("deleteBuySell");
          toastr.info("Buy/Sell delete process started.");
          break;

        case "unarchiveStarted":
          markStarted("unarchive");
          toastr.info("Unarchive process started.");
          break;

        case "deleteProgress":
        case "archiveProgress":
        case "deleteBuySellProgress":
        case "unarchiveProgress":
          $scope.lastProgress = "Processed: " + (request.count || 0);
          break;

        case "noMessagesToDlt":
          markComplete("delete");
          toastr.clear();
          toastr.success(
            request.message || "No Messages Found / All Deleted Successfully",
          );
          break;

        case "NoMsgsToArchv":
          markComplete("archive");
          toastr.clear();
          toastr.success(
            request.message || "No Messages Found / All Archived Successfully",
          );
          break;

        case "BuySellLoadingWait":
          $scope.BuySellLoadingWait = true;
          break;

        case "loadedCompleteBuySell":
          $scope.BuySellLoadingWait = false;
          $scope.BuySellOpenNow = true;
          toastr.success("Marketplace messages opened.");
          break;

        case "noBuySell":
          $scope.BuySellLoadingWait = false;
          $scope.BuySellOpenNow = false;
          toastr.info(request.message || "No Buy/Sell Found");
          break;

        case "noBuySellMsgs":
          markComplete("deleteBuySell");
          toastr.info(request.message || "No Buy/Sell Messages / All Deleted.");
          break;

        case "loadedCompleteArchived":
          $scope.archivedLoadingWait = false;
          $scope.archivedOpenNow = true;
          toastr.success("Archived messages opened.");
          break;

        case "noArchivedMsgs":
          $scope.archivedLoadingWait = false;
          markComplete("unarchive");
          toastr.info(
            request.message || "No Archived Messages / All Unarchived.",
          );
          break;

        case "automationStopped":
          resetProcessingFlags();
          toastr.info("Process stopped.");
          break;

        case "automationWarning":
          console.warn("Automation warning:", request);
          break;

        case "automationError":
        case "deleteError":
        case "archiveError":
        case "deleteBuySellError":
        case "unarchiveError":
        case "clickError":
          resetProcessingFlags();
          toastr.error(
            request.message || request.error || "Automation failed.",
            "Error",
          );
          break;
      }
    });
  });

  // Keep existing activation function so the HTML does not break.
  $scope.verify_license = function () {
    $scope.license = true;
    $scope.trialsLimitComplete = false;
    toastr.success("Unlimited Mode Activated", "Success");
  };

  $scope.checkActivePage();
});
