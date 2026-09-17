# Messenger Test Fixture, Safe Capture & Testing Guide

This directory contains a realistic, privacy-safe Facebook Messenger mock fixture, an observation-only DOM structure capture utility, automated Playwright tests, and development safety guards for `chrome-delete-facebook-messages`.

---

## Architecture & Modes

The testing workflow provides three distinct modes:

1. **REAL CAPTURE MODE (Observation-Only)**:
   Extracts DOM hierarchy, accessibility roles, aria attributes, dimensions, and control semantics from an active Messenger session without capturing private text, names, IDs, tokens, or messages. Automatically redacts labels to deterministic placeholders (e.g. `Person 001`, `Test Marketplace Thread 001`).

2. **LOCAL MOCK MODE**:
   A local HTTP mock server rendering realistic Facebook Messenger conversations, menus, settings, archived messages, Marketplace headers, and confirmation dialogs. All actions (Delete, Archive, Unarchive) execute against this mock state.

3. **REAL DRY-RUN MODE**:
   Inspects real Messenger DOM and reports what it would click, but aborts before triggering any destructive action or confirmation dialog, leaving the real session completely untouched.

---

## 1. Capturing a Sanitized Structure from Real Chrome/Messenger

> [!CAUTION]
> **Observation-Only Rule**: Never click Delete, Archive, or submit confirmation dialogs while connected to live Messenger. Capture is strictly read-only.

To capture the current Messenger DOM structure without leaking private data:

1. Open Chrome and navigate to [Facebook Messages](https://www.facebook.com/messages/).
2. Open Chrome DevTools (`F12` or `Cmd + Option + I` on macOS).
3. Switch to the **Console** tab.
4. Open [`test/capture-messenger-fixture.js`](capture-messenger-fixture.js), copy its entire contents, paste it into the DevTools Console, and press **Enter**.
5. To download the sanitized structure JSON file, run:
   ```javascript
   DeleteFacebookMessagesFixtureCapture.download();
   ```
   *(Or copy to clipboard by running `DeleteFacebookMessagesFixtureCapture.copy()`)*.
6. The file will download as `messenger-structure.json`. Move this file to `test/fixtures/messenger-structure.json`.

---

## 2. Reviewing the Capture for Privacy

The capture tool automatically scans for sensitive data before outputting JSON, but you can also run the automated privacy validator locally:

```bash
node test/update-fixture.js test/fixtures/messenger-structure.json
```

The validator verifies that the capture contains:
- **NO** email addresses (`user@domain.com`)
- **NO** phone numbers
- **NO** long numeric Facebook IDs (`\b\d{10,}\b`)
- **NO** tokens or sensitive keywords (`fbid`, `user_id`, `thread_id`, `message_id`, `access_token`, `cookie`)
- **NO** Facebook profile links (`profile.php?id=...` or `/messages/t/...`)
- **NO** long opaque hashes or session tokens

If any sensitive pattern is detected, the validator aborts immediately with an error.

---

## 3. Generating / Updating the Local Fixture

Once a new `messenger-structure.json` is validated, the mock messenger in [`test/mock-messenger/`](mock-messenger/) uses the structural schema (selectors, buttons, menus, and dialogs) to render the mock environment.

To test and confirm the fixture integrity:
```bash
node test/update-fixture.js
```

---

## 4. Launching the Local Fixture Server

To manually view and interact with the local mock fixture in your browser:

```bash
npm run serve:fixture
```

Open [http://127.0.0.1:4173/test/mock-messenger/](http://127.0.0.1:4173/test/mock-messenger/) in Chrome.

The mock fixture includes:
- 11 initial conversations (including unread threads, a duplicate display name `Person 002`, and an ultra-long thread name)
- Interactive "More options for..." buttons (`div[role="button"][aria-label^="More options for"]`)
- Realistic floating menus (`[role="menu"]`) with `Archive` and `Delete chat`
- Realistic modal confirmation dialogs (`[role="dialog"][aria-modal="true"]`) with secondary ("Learn more"), Cancel, and Delete buttons
- Settings menu with "Archived chats" navigation
- Marketplace folder and product banner options

---

## 5. Loading / Injecting the Extension for Fixture Testing

### Option A: Manual Testing in Chrome
1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (top right toggle).
3. Click **Load unpacked** and select the root directory of this repository (`chrome-delete-facebook-messages`).
4. Navigate to [http://127.0.0.1:4173/test/mock-messenger/](http://127.0.0.1:4173/test/mock-messenger/).
5. The fixture page is marked with `<html data-delete-facebook-messages-fixture="true">`, allowing the content script and popup to safely recognize it as a valid test target.
6. Click the extension icon in Chrome's toolbar to open the popup and trigger operations.

### Option B: Automated Testing with Playwright
The automated test runner injects the extension script directly into the fixture environment with isolated Chrome extension API mocks:
```bash
npm test
```

---

## 6. Running Automated Tests

Run the full Playwright test suite against the local fixture:

```bash
npm test
```

Or run the fixture specification specifically:
```bash
npm run test:fixture
```

### Safety & Offline Protection
The test runner enforces a hard network interception guard:
- Any network request or navigation targeting `facebook.com`, `messenger.com`, `fbcdn.net`, or `facebook.net` is immediately aborted and fails the test.
- All tests execute strictly offline against `127.0.0.1:4173`.

### 20 Covered Test Scenarios:
1. Detect fake conversations
2. Open correct More Options menu
3. Delete exactly one fake conversation
4. Delete multiple fake conversations
5. Archive one conversation
6. Archive multiple conversations
7. Open archived messages
8. Unarchive messages
9. Stop an operation mid-stream
10. Handle missing menu item
11. Handle missing confirmation button
12. Handle a menu that fails to open
13. Duplicate conversation display names (identity collision avoidance)
14. Confirmation dialog contains unrelated buttons ("Learn more", "Cancel")
15. Ensure Cancel is never mistaken for Delete
16. Ensure one logical action causes only one logical click (no duplicate events)
17. Dry run changes zero fixture records
18. Processing count matches actual completed operations
19. Marketplace fixture flow (banner and options)
20. Verify no test ever navigates to facebook.com or messenger.com

---

## 7. Running Real-Site Dry-Run Mode

Dry-run mode allows the extension to inspect the real Messenger UI, verify that buttons and menus are detected, and report diagnostics without deleting or archiving anything.

### Enabling Dry Run in Popup:
1. Open Facebook Messages.
2. Click the extension icon to open the popup.
3. Click the purple button: **"Enable dry run (no changes)"**.
4. The button changes to: **"🛡️ DRY RUN ACTIVE — no changes"**.
5. Click **Delete All Messages** or **Archive All Messages**.

### Safety Guarantees During Dry Run:
- The content script identifies the thread and opens the "More options for..." menu.
- It finds the target action item (e.g., "Delete chat").
- It logs diagnostics:
  ```text
  [DRY RUN] Found thread: Person 001. Found menu action: Delete chat. Would stop before selecting it.
  ```
- It immediately presses `Escape` to close the menu.
- It does **NOT** click the menu item or confirmation button.
- It returns `{ status: "skipped", reason: "dry_run_action_not_selected", dryRun: true }`.
- **Zero changes** are made to the conversation list.

---

## 8. Inspecting Selector Diagnostics

To inspect selector matches on any page (real Messenger or local fixture):

1. Open DevTools Console.
2. Run:
   ```javascript
   DeleteFacebookMessagesDebug.snapshot();
   ```
3. This displays a diagnostic table containing:
   - Total detected thread menu buttons
   - Labels and vertical positions of each row
   - Settings button presence
   - Visible dialogs, confirmation roots, and menus

---

## 9. Updating the Fixture when Facebook Changes its DOM

When Facebook updates Messenger's DOM structure (e.g. changing `aria-label`, button nesting, or dialog classes):

1. Open the updated Facebook Messenger page in Chrome.
2. Run `DeleteFacebookMessagesFixtureCapture.download()` from the DevTools Console as described in Step 1.
3. Validate and update the fixture:
   ```bash
   node test/update-fixture.js ~/Downloads/messenger-structure.json
   ```
4. Compare the captured structure against [`js/script.js`](../js/script.js) `SELECTORS` and [`test/mock-messenger/mock-messenger.js`](mock-messenger/mock-messenger.js).
5. Update selectors in `js/script.js` if necessary.
6. Run tests to verify the updated selectors pass:
   ```bash
   npm test
   ```
