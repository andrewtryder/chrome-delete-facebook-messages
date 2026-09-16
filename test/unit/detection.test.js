"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

describe("Page and URL Detection Unit Tests", () => {
  const checkUrl = (url) => {
    return (
      /facebook\.com\/(messages|latest\/inbox)/i.test(url || "") ||
      /messenger\.com/i.test(url || "") ||
      /(?:127\.0\.0\.1|localhost):4173/i.test(url || "") ||
      /(?:127\.0\.0\.1|localhost):\d+\/test\/mock-messenger/i.test(url || "")
    );
  };

  test("accepts valid Facebook messages and Messenger URLs", () => {
    assert.equal(checkUrl("https://www.facebook.com/messages/"), true);
    assert.equal(checkUrl("https://www.facebook.com/messages/t/1234567890"), true);
    assert.equal(checkUrl("https://www.facebook.com/latest/inbox"), true);
    assert.equal(checkUrl("https://www.messenger.com/"), true);
    assert.equal(checkUrl("https://www.messenger.com/t/9876543210"), true);
  });

  test("accepts local test fixture URLs", () => {
    assert.equal(checkUrl("http://127.0.0.1:4173/"), true);
    assert.equal(checkUrl("http://localhost:4173/"), true);
    assert.equal(checkUrl("http://127.0.0.1:8080/test/mock-messenger/index.html"), true);
  });

  test("rejects unrelated URLs", () => {
    assert.equal(checkUrl("https://www.facebook.com/home.php"), false);
    assert.equal(checkUrl("https://www.facebook.com/friends"), false);
    assert.equal(checkUrl("https://www.google.com/"), false);
    assert.equal(checkUrl("https://example.com/messages/"), false);
    assert.equal(checkUrl(""), false);
    assert.equal(checkUrl(null), false);
  });
});

describe("Marketplace Signal Classification Logic", () => {
  function classifyMarketplaceSignals({
    pathname,
    isFixture,
    hasItemLink,
    hasProductBanner,
    hasHeaderMoreOptions,
    hasConversationTitleOnly,
  }) {
    if (!/\/messages\/t\//i.test(pathname) && !isFixture) return false;

    // Genuine marketplace signals
    return (
      hasItemLink ||
      hasProductBanner ||
      hasHeaderMoreOptions
    );
  }

  test("classifies chat as marketplace when authentic item link is present", () => {
    const isMp = classifyMarketplaceSignals({
      pathname: "/messages/t/1001",
      isFixture: false,
      hasItemLink: true,
      hasProductBanner: false,
      hasHeaderMoreOptions: false,
      hasConversationTitleOnly: true,
    });
    assert.equal(isMp, true);
  });

  test("classifies chat as marketplace when authentic product banner is present", () => {
    const isMp = classifyMarketplaceSignals({
      pathname: "/messages/t/1001",
      isFixture: false,
      hasItemLink: false,
      hasProductBanner: true,
      hasHeaderMoreOptions: false,
      hasConversationTitleOnly: true,
    });
    assert.equal(isMp, true);
  });

  test("NEVER classifies normal chat as marketplace when only conversation title is present", () => {
    const isMp = classifyMarketplaceSignals({
      pathname: "/messages/t/1001",
      isFixture: false,
      hasItemLink: false,
      hasProductBanner: false,
      hasHeaderMoreOptions: false,
      hasConversationTitleOnly: true,
    });
    assert.equal(isMp, false);
  });
});
