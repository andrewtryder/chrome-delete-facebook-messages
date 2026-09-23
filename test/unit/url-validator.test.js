"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { checkUrl } = require("../../src/browser_action/js/browser_action");

describe("Strict URL Validation Unit Tests", () => {
  describe("Production URL checking (allowDev = false)", () => {
    test("accepts valid Facebook messages and Messenger URLs", () => {
      assert.equal(checkUrl("https://www.facebook.com/messages/", false), true);
      assert.equal(checkUrl("https://www.facebook.com/messages/t/1234567890", false), true);
      assert.equal(checkUrl("https://facebook.com/messages", false), true);
      assert.equal(checkUrl("https://www.facebook.com/latest/inbox", false), true);
      assert.equal(checkUrl("https://www.facebook.com/latest/inbox/", false), true);
      assert.equal(checkUrl("https://www.messenger.com/", false), true);
      assert.equal(checkUrl("https://messenger.com/", false), true);
      assert.equal(checkUrl("https://www.messenger.com/t/9876543210", false), true);
    });

    test("rejects localhost/fixture URLs in production mode", () => {
      assert.equal(checkUrl("http://127.0.0.1:4173/", false), false);
      assert.equal(checkUrl("http://localhost:4173/", false), false);
      assert.equal(checkUrl("http://127.0.0.1:4174/", false), false);
      assert.equal(checkUrl("http://127.0.0.1:8080/test/mock-messenger/index.html", false), false);
    });

    test("rejects lookalike / hostile domains attempting substring tricks", () => {
      assert.equal(checkUrl("https://example.org/foo/messenger.com/bar", false), false);
      assert.equal(checkUrl("https://evil-messenger.com/", false), false);
      assert.equal(checkUrl("https://facebook.com.evil.org/messages", false), false);
      assert.equal(checkUrl("https://notfacebook.com/messages", false), false);
      assert.equal(checkUrl("https://example.com/messages/", false), false);
    });

    test("rejects Facebook non-messenger URLs", () => {
      assert.equal(checkUrl("https://www.facebook.com/home.php", false), false);
      assert.equal(checkUrl("https://www.facebook.com/friends", false), false);
      assert.equal(checkUrl("https://www.facebook.com/marketplace", false), false);
      assert.equal(checkUrl("https://www.facebook.com/settings", false), false);
    });

    test("rejects insecure HTTP protocols for production domains", () => {
      assert.equal(checkUrl("http://www.facebook.com/messages/", false), false);
      assert.equal(checkUrl("http://www.messenger.com/", false), false);
    });

    test("handles empty and malformed inputs gracefully", () => {
      assert.equal(checkUrl("", false), false);
      assert.equal(checkUrl(null, false), false);
      assert.equal(checkUrl(undefined, false), false);
      assert.equal(checkUrl("not a valid url", false), false);
      assert.equal(checkUrl("javascript:alert(1)", false), false);
    });
  });

  describe("Development URL checking (allowDev = true)", () => {
    test("accepts local test fixture URLs when dev is permitted", () => {
      assert.equal(checkUrl("http://127.0.0.1:4173/", true), true);
      assert.equal(checkUrl("http://localhost:4173/", true), true);
      assert.equal(checkUrl("http://127.0.0.1:4174/", true), true);
      assert.equal(checkUrl("http://localhost:4174/", true), true);
      assert.equal(checkUrl("http://127.0.0.1:8080/test/mock-messenger/index.html", true), true);
    });
  });
});
