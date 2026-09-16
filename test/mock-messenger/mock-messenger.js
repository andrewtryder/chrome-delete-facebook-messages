(function () {
  "use strict";

  const fixtureModel = (typeof window !== "undefined" && window.__GENERATED_FIXTURE_MODEL__) || {
    threadMenuButton: {
      tag: "div",
      role: "button",
      ariaHaspopup: "menu",
      ariaControls: "thread-list-menu-buttons",
      tabindex: "0",
      labelPattern: "More options for {name}",
    },
    menu: {
      menuRole: "menu",
      menuId: "thread-list-menu-buttons",
      itemRole: "menuitem",
      itemTag: "button",
      labels: {
        delete: "Delete chat",
        archive: "Archive",
        restore: "Restore",
      },
    },
    dialog: {
      dialogRole: "dialog",
      labels: {
        confirmDelete: "Delete chat",
        cancel: "Cancel",
        unrelatedAction: "Learn more",
      },
    },
  };

  const initialInbox = [
    { id: "normal-1", name: "Person 001", unread: false },
    { id: "normal-2", name: "Person 002", unread: true },
    { id: "normal-3", name: "Example Group", unread: false },
    { id: "normal-4", name: "Person 002", unread: false }, // Duplicate display name
    {
      id: "normal-5",
      name: "A deliberately very long fixture conversation name used to test truncation and selectors in modern layouts",
      unread: false,
    },
    { id: "normal-6", name: "Fixture Thread 06", unread: true },
    { id: "normal-7", name: "Fixture Thread 07", unread: false },
    { id: "normal-8", name: "Fixture Thread 08", unread: false },
    { id: "normal-9", name: "Fixture Thread 09", unread: false },
    { id: "normal-10", name: "Fixture Thread 10", unread: true },
    { id: "normal-11", name: "Fixture Thread 11", unread: false },
  ];

  const initialArchived = [
    { id: "archived-1", name: "Archived Person 001", unread: false },
    { id: "archived-2", name: "Archived Person 002", unread: false },
  ];

  const initialMarketplace = [
    { id: "market-1", name: "Test Marketplace Buyer", unread: false },
  ];

  const state = {
    inbox: JSON.parse(JSON.stringify(initialInbox)),
    archived: JSON.parse(JSON.stringify(initialArchived)),
    marketplace: JSON.parse(JSON.stringify(initialMarketplace)),
    view: "inbox",
    totalClicks: 0,
    deletedCount: 0,
    archivedCount: 0,
    unarchivedCount: 0,
  };

  const flags = {
    failOpen: false,
    missingDelete: false,
    missingConfirm: false,
  };

  const clickLog = [];

  document.addEventListener(
    "click",
    (e) => {
      state.totalClicks++;
      clickLog.push({
        targetTag: e.target.tagName,
        ariaLabel: e.target.getAttribute("aria-label"),
        text: (e.target.textContent || "").trim(),
        role: e.target.getAttribute("role"),
        time: Date.now(),
      });
    },
    true,
  );

  const listEl = document.querySelector("#thread-list");
  const statusEl = document.querySelector("#fixture-status");
  const marketplaceBanner = document.querySelector("#marketplace-banner");
  const mainPlaceholder = document.querySelector("#main-placeholder");
  const inboxEntry = document.querySelector("#inbox-entry");
  const marketplaceEntry = document.querySelector("#marketplace-entry");
  const settingsBtn = document.querySelector("#settings");
  const marketplaceHeaderMore = document.querySelector("#marketplace-header-more");

  function currentThreads() {
    return state[state.view] || [];
  }

  function closeOverlays() {
    document
      .querySelectorAll(".menu, .dialog-backdrop")
      .forEach((el) => el.remove());
  }

  function render() {
    closeOverlays();
    listEl.replaceChildren();

    const viewName = state.view.charAt(0).toUpperCase() + state.view.slice(1);
    const threads = currentThreads();
    statusEl.textContent = `${viewName} (${threads.length})`;

    // Nav active styles
    inboxEntry.classList.toggle("active", state.view === "inbox");
    marketplaceEntry.classList.toggle("active", state.view === "marketplace");

    // Marketplace banner display
    if (state.view === "marketplace" && state.marketplace.length > 0) {
      marketplaceBanner.style.display = "flex";
      mainPlaceholder.style.display = "none";
    } else {
      marketplaceBanner.style.display = "none";
      mainPlaceholder.style.display = "flex";
    }

    threads.forEach((thread) => {
      const row = document.createElement("article");
      row.className = `thread${thread.unread ? " unread" : ""}`;
      row.setAttribute("role", "listitem");
      row.dataset.threadId = thread.id;

      const content = document.createElement("div");
      content.className = "thread-content";

      const nameSpan = document.createElement("span");
      nameSpan.className = "name";
      nameSpan.textContent = thread.name;

      const previewSpan = document.createElement("span");
      previewSpan.className = "thread-preview";
      previewSpan.textContent = "Safe mock preview message text";

      content.append(nameSpan, previewSpan);

      // Thread menu button driven by generated fixture model semantics
      const btnCfg = fixtureModel.threadMenuButton || {};
      const moreBtn = document.createElement(btnCfg.tag || "div");
      moreBtn.setAttribute("role", btnCfg.role || "button");
      const labelPattern = btnCfg.labelPattern || "More options for {name}";
      moreBtn.setAttribute("aria-label", labelPattern.replace("{name}", thread.name));
      moreBtn.setAttribute("aria-controls", btnCfg.ariaControls || "thread-list-menu-buttons");
      moreBtn.setAttribute("aria-haspopup", btnCfg.ariaHaspopup || "menu");
      moreBtn.setAttribute("tabindex", btnCfg.tabindex || "0");
      moreBtn.className = "more-btn";
      moreBtn.textContent = "•••";

      moreBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openThreadMenu(thread, moreBtn);
      });

      row.append(content, moreBtn);
      listEl.append(row);
    });
  }

  function createMenuItem(label, onClick) {
    const itemTag = fixtureModel.menu?.itemTag || "button";
    const btn = document.createElement(itemTag);
    btn.setAttribute("role", fixtureModel.menu?.itemRole || "menuitem");
    btn.setAttribute("type", "button");
    btn.textContent = label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  function openThreadMenu(thread, anchorEl) {
    closeOverlays();
    if (flags.failOpen) return;

    const menu = document.createElement("div");
    menu.className = "menu";
    menu.id = fixtureModel.menu?.menuId || "thread-list-menu-buttons";
    menu.setAttribute("role", fixtureModel.menu?.menuRole || "menu");

    const rect = anchorEl.getBoundingClientRect();
    menu.style.left = `${Math.max(10, rect.left - 150)}px`;
    menu.style.top = `${rect.bottom + 4}px`;

    const labels = fixtureModel.menu?.labels || {};
    if (state.view === "archived") {
      menu.append(
        createMenuItem(labels.restore || "Restore", () => {
          moveThread(thread, "archived", "inbox");
          state.unarchivedCount++;
        }),
      );
    } else {
      menu.append(
        createMenuItem(labels.archive || "Archive", () => {
          moveThread(thread, state.view, "archived");
          state.archivedCount++;
        }),
      );

      if (!flags.missingDelete) {
        menu.append(
          createMenuItem(labels.delete || "Delete chat", () => {
            confirmDelete(thread);
          }),
        );
      }
    }

    document.body.append(menu);
  }

  function moveThread(thread, fromList, toList) {
    state[fromList] = state[fromList].filter((t) => t.id !== thread.id);
    state[toList].unshift(thread);
    render();
  }

  function confirmDelete(thread) {
    closeOverlays();

    const dialogLabels = fixtureModel.dialog?.labels || {};
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.setAttribute("role", fixtureModel.dialog?.dialogRole || "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-label", dialogLabels.confirmDelete || "Delete chat");

    const dialog = document.createElement("div");
    dialog.className = "dialog";

    const heading = document.createElement("h2");
    heading.textContent = dialogLabels.confirmDelete || "Delete chat";

    const desc = document.createElement("p");
    desc.textContent = "Delete your copy of this chat? This cannot be undone.";

    const footer = document.createElement("footer");

    // Secondary / unrelated button
    const learnMoreBtn = document.createElement("button");
    learnMoreBtn.setAttribute("role", "button");
    learnMoreBtn.setAttribute("type", "button");
    learnMoreBtn.className = "btn-secondary";
    learnMoreBtn.textContent = dialogLabels.unrelatedAction || "Learn more";
    learnMoreBtn.addEventListener("click", () => {
      // Harmless no-op button to test button discrimination
    });

    // Cancel button
    const cancelBtn = document.createElement("button");
    cancelBtn.setAttribute("role", "button");
    cancelBtn.setAttribute("type", "button");
    cancelBtn.className = "btn-cancel";
    cancelBtn.textContent = dialogLabels.cancel || "Cancel";
    cancelBtn.addEventListener("click", () => {
      closeOverlays();
    });

    footer.append(learnMoreBtn, cancelBtn);

    // Confirm button
    if (!flags.missingConfirm) {
      const confirmBtn = document.createElement("button");
      confirmBtn.setAttribute("role", "button");
      confirmBtn.setAttribute("type", "button");
      confirmBtn.className = "btn-confirm danger";
      confirmBtn.textContent = dialogLabels.confirmDelete || "Delete chat";
      confirmBtn.addEventListener("click", () => {
        state[state.view] = currentThreads().filter((t) => t.id !== thread.id);
        state.deletedCount++;
        render();
      });
      footer.append(confirmBtn);
    }

    dialog.append(heading, desc, footer);
    backdrop.append(dialog);
    document.body.append(backdrop);
  }

  // Settings menu
  settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeOverlays();

    const menu = document.createElement("div");
    menu.className = "menu";
    menu.id = "mw-inbox-settings-menu";
    menu.setAttribute("role", "menu");

    const rect = settingsBtn.getBoundingClientRect();
    menu.style.left = `${Math.max(10, rect.left - 120)}px`;
    menu.style.top = `${rect.bottom + 6}px`;

    menu.append(
      createMenuItem("Archived chats", () => {
        state.view = "archived";
        render();
      }),
    );

    document.body.append(menu);
  });

  // Navigation handlers
  inboxEntry.addEventListener("click", () => {
    state.view = "inbox";
    render();
  });

  marketplaceEntry.addEventListener("click", () => {
    state.view = "marketplace";
    render();
  });

  // Marketplace header More options
  marketplaceHeaderMore.addEventListener("click", (e) => {
    e.stopPropagation();
    closeOverlays();

    const menu = document.createElement("div");
    menu.className = "menu";
    menu.id = "thread-list-menu-buttons";
    menu.setAttribute("role", "menu");

    const rect = marketplaceHeaderMore.getBoundingClientRect();
    menu.style.left = `${Math.max(10, rect.left)}px`;
    menu.style.top = `${rect.bottom + 6}px`;

    const currentMarketplaceThread = state.marketplace[0] || {
      id: "market-1",
      name: "Test Marketplace Buyer",
    };

    menu.append(
      createMenuItem("Delete chat", () => {
        confirmDelete(currentMarketplaceThread);
      }),
    );

    document.body.append(menu);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOverlays();
  });

  window.MockMessenger = {
    state,
    flags,
    clickLog,
    reset() {
      state.inbox = JSON.parse(JSON.stringify(initialInbox));
      state.archived = JSON.parse(JSON.stringify(initialArchived));
      state.marketplace = JSON.parse(JSON.stringify(initialMarketplace));
      state.view = "inbox";
      state.totalClicks = 0;
      state.deletedCount = 0;
      state.archivedCount = 0;
      state.unarchivedCount = 0;
      flags.failOpen = false;
      flags.missingDelete = false;
      flags.missingConfirm = false;
      clickLog.length = 0;
      render();
    },
    render,
    closeOverlays,
  };

  render();
})();
