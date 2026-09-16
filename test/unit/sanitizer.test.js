"use strict";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  sanitizeString,
  normalizeStructureIds,
  validate,
  resetCaptureState,
  SUSPICIOUS_PATTERNS,
} = require("../capture-messenger-fixture");

describe("Sanitizer and Privacy Unit Tests", () => {
  beforeEach(() => {
    resetCaptureState();
  });

  test("preserves allowlisted control words verbatim", () => {
    assert.equal(sanitizeString("Delete chat"), "Delete chat");
    assert.equal(sanitizeString("Archive"), "Archive");
    assert.equal(sanitizeString("Settings, help and more"), "Settings, help and more");
    assert.equal(sanitizeString("More options"), "More options");
  });

  test("anonymizes personal conversation titles and options labels", () => {
    assert.equal(
      sanitizeString("More options for Alice Wonder"),
      "More options for Person 001",
    );
    assert.equal(
      sanitizeString("More options for Bob Builder"),
      "More options for Person 002",
    );
    assert.equal(
      sanitizeString("Conversation titled Alice Wonder"),
      "Conversation titled Person 001",
    );
  });

  test("canonicalizes delete warning and confirmation text without leaking names", () => {
    assert.equal(
      sanitizeString("Delete chat with Andrew Smith"),
      "Delete chat",
    );
    assert.equal(
      sanitizeString("Delete conversation with Charlie Brown"),
      "Delete conversation",
    );
    assert.equal(
      sanitizeString("Delete your copy of the conversation with Andrew Smith"),
      "[delete-warning]",
    );
    assert.equal(
      sanitizeString("This cannot be undone for Andrew Smith"),
      "[delete-warning]",
    );
  });

  test("redacts unrecognized freeform text", () => {
    assert.equal(sanitizeString("Hey what is your phone number?"), "[redacted]");
  });

  test("resetCaptureState cleans counters and person mappings", () => {
    sanitizeString("More options for First Person");
    resetCaptureState();
    assert.equal(
      sanitizeString("More options for New Person"),
      "More options for Person 001",
    );
  });

  test("validates schema contract", () => {
    assert.throws(() => validate(null), /must be an object/);
    assert.throws(() => validate({}), /missing or invalid schema version/);
    assert.throws(() => validate({ schema: 1 }), /missing structures array/);
    assert.equal(validate({ schema: 1, structures: [] }), true);
  });

  test("detects suspicious patterns in fixture structures", () => {
    const dataWithEmail = {
      schema: 1,
      structures: [{ text: "contact me at user@example.com" }],
    };
    assert.throws(() => validate(dataWithEmail), /possible private data detected/);

    const dataWithToken = {
      schema: 1,
      structures: [{ token: "access_token=secret_123" }],
    };
    assert.throws(() => validate(dataWithToken), /possible private data detected/);
  });

  test("normalizes runtime IDs deterministically", () => {
    const raw = {
      attrs: {
        id: "random_dynamic_fb_id_999",
        "aria-controls": "random_dynamic_fb_id_999 mw-inbox-settings-menu",
      },
      children: [],
    };
    normalizeStructureIds(raw);
    assert.equal(raw.attrs.id, "generated-id-001");
    assert.equal(raw.attrs["aria-controls"], "generated-id-001 mw-inbox-settings-menu");
  });
});
