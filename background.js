chrome.runtime.onInstalled.addListener(e => {
    if ("install" !== e.reason && "update" !== e.reason) return;
    chrome.tabs.query({ url: "*://www.facebook.com/messages*" }, e => {
        e.length > 0 ? (
            chrome.tabs.reload(e[0].id),
            chrome.tabs.update(e[0].id, { active: !0 }),
            chrome.windows.update(e[0].windowId, { focused: !0 })
        ) : chrome.tabs.create({ url: "https://www.facebook.com/messages/" });
    });
});