/* Auto-generated from test/fixtures/messenger-structure.json by test/generate-fixture.js */
(function (root) {
  "use strict";
  const model = {
  "source": "messenger-structure.json",
  "generatedFromHash": "11fb58ec0960d04a856c361825612b1aacb506dc6d4dcd516490f95d318d1676",
  "threadMenuButton": {
    "tag": "div",
    "role": "button",
    "ariaHaspopup": "menu",
    "ariaControls": "thread-list-menu-buttons",
    "tabindex": "-1",
    "labelPattern": "More options for {name}",
    "dimensions": {
      "width": 36,
      "height": 36
    }
  },
  "marketplaceNav": {
    "tag": "a",
    "role": "link",
    "ariaLabel": "Marketplace",
    "dimensions": {
      "width": 112,
      "height": 56
    }
  },
  "settingsButton": {
    "tag": "div",
    "role": "button",
    "ariaLabel": "Settings, help and more",
    "ariaControls": "mw-inbox-settings-menu",
    "ariaHaspopup": "menu"
  },
  "marketplaceBanner": {
    "dialogRole": "button",
    "ariaLabelPattern": "Conversation titled {name}",
    "moreOptions": {
      "role": "button",
      "ariaLabel": "More options",
      "ariaHaspopup": "dialog",
      "dimensions": {
        "width": 136,
        "height": 36
      }
    }
  },
  "menu": {
    "menuRole": "menu",
    "menuId": "thread-list-menu-buttons",
    "itemRole": "menuitem",
    "itemTag": "button",
    "labels": {
      "delete": "Delete chat",
      "archive": "Archive",
      "restore": "Restore"
    }
  },
  "dialog": {
    "dialogRole": "dialog",
    "labels": {
      "confirmDelete": "Delete chat",
      "cancel": "Cancel",
      "unrelatedAction": "Learn more"
    }
  }
};
  if (typeof module === "object" && module.exports) {
    module.exports = model;
  } else {
    root.__GENERATED_FIXTURE_MODEL__ = model;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
