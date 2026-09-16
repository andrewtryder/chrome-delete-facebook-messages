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

---

## Release & Versioning (Maintainer Guide)

This repository uses **Semantic Versioning**, **Conventional Commits**, and **Google's Release Please** for automated release management.

> ⚠️ **Important:** Do NOT create releases or tags manually.

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
