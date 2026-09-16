# Delete Facebook Messages Fast 2026

Chrome Extension for deleting, archiving, and managing Facebook Messenger conversations quickly and safely.

---

## Features

- **Delete Regular Messages**: Cleans normal Messenger Inbox conversations.
- **Delete Marketplace Messages**: Dedicated button for Facebook Marketplace / Buy & Sell chats.
- **Archive & Restore**: Archive threads or restore all archived conversations.
- **Dry Run Mode**: Audits and simulates actions without clicking destructive buttons.
- **Speed Controls**: Configurable action pacing (Slow, Normal, Fast, Very Fast, Ultra).
- **Offline Mock Fixture**: Offline testing environment using realistic Messenger structures without touching live accounts.

---

## Testing & Local Development

Install dependencies:
```bash
npm install
```

Run test suite:
```bash
npm test
```

Start the local mock Messenger server:
```bash
npm run serve:fixture
# Open http://127.0.0.1:4173/test/mock-messenger/ in Chrome
```

### Development Manifest vs Shipping Manifest

To test the unpacked extension manually against the local mock fixture server in Chrome, enable development host permissions:
```bash
npm run manifest:dev   # Adds localhost / 127.0.0.1 matches to manifest.json
```

Before packaging or committing for production:
```bash
npm run manifest:prod  # Restores strictly production matches (Facebook/Messenger only)
npm run manifest:check # Validates no localhost matches exist in manifest.json
```

### Fixture Generation Pipeline

To refresh the mock fixture structure from a sanitized DevTools capture:
1. Capture sanitized DOM via `test/capture-messenger-fixture.js` in DevTools.
2. Validate and generate normalized structural model:
```bash
npm run fixture:validate  # Validates privacy and normalizes runtime IDs
npm run fixture:generate  # Derives normalized structural model for mock-messenger
# or run both together:
npm run fixture:update
```

---

## Release & Versioning (Maintainer Guide)

This repository uses **Semantic Versioning**, **Conventional Commits**, and **Google's Release Please** for automated release management.

> ⚠️ **Important:** Do NOT create releases or tags manually.

### Versioning & Chrome Web Store Semantics

- The previous release uploaded to the Chrome Web Store was version `3.8`.
- The repository baseline has been normalized to `3.8.0` (SemVer 2.0.0 requires `MAJOR.MINOR.PATCH`).
- Chrome Web Store parses version strings as dot-separated integers. The next automated release will be `3.8.1` (patch) or `3.9.0` (minor), both of which sort cleanly after `3.8` in CWS integer component comparison.
- Manifest `version` in [`manifest.json`](manifest.json) is the authoritative version and is kept synchronized automatically by Release Please.

### Automated Release Flow

1. Work is performed in feature branches and submitted as Pull Requests with Conventional Commit titles (e.g. `feat: ...`, `fix: ...`).
2. PRs are merged to `main` using **Squash and Merge**.
3. On merge, Release Please runs automatically:
   - If release-worthy commits exist (`feat` or `fix`), Release Please opens or updates a **Release PR**.
   - The Release PR contains the bumped version and updated `CHANGELOG.md`.
   - The authoritative product version in [`manifest.json`](manifest.json) is updated to match.
4. When you are ready to publish, merge the **Release PR**.
5. Release Please tags the release (e.g. `v3.8.1`) and creates the GitHub Release.

For more details on commit formatting and workflow rules, see [CONTRIBUTING.md](CONTRIBUTING.md).
