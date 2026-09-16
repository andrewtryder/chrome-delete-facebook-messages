# Contributing to Delete Facebook Messages Fast

Thank you for contributing! To maintain high code quality and enable automated releases, this repository follows Semantic Versioning, Conventional Commits, and automated release grooming via Google's Release Please.

---

## Branch Workflow

1. Create a descriptive branch off `main`:
   ```bash
   git checkout -b feat/my-new-feature
   # or
   git checkout -b fix/issue-description
   ```
2. Commit your changes. You can make as many working commits on your branch as needed.
3. Open a Pull Request targeting `main`.
4. Ensure your **Pull Request title** follows the Conventional Commits specification (detailed below).
5. All CI checks (`PR title`, `actionlint`, `test`) must pass before merge.
6. The PR is merged using **Squash and Merge**. The PR title becomes the single commit message landed on `main`.

---

## Conventional Commits & PR Titles

Pull request titles are validated against the Conventional Commits 1.0 specification by CI.

### Format

```text
<type>(<optional scope>): <description>
```

- Scopes are optional (e.g., `fix(selectors): update confirm button selector` or `fix: update confirm button selector`).
- Do not end the title with a period.

### Supported Types

| Type | Purpose | Release Trigger |
|---|---|---|
| `feat` | New feature or capability | **MINOR** version bump (e.g., 3.8.0 → 3.9.0) |
| `fix` | Bug fix | **PATCH** version bump (e.g., 3.8.0 → 3.8.1) |
| `perf` | Performance improvement | **PATCH** version bump |
| `refactor` | Code refactoring without feature/bug change | Included in changelog, no version bump |
| `docs` | Documentation updates | Included in changelog, no version bump |
| `style` | Code style/formatting changes | Hidden from changelog, no version bump |
| `test` | Adding or updating tests | Hidden from changelog, no version bump |
| `build` | Build system or dependency updates | Hidden from changelog, no version bump |
| `ci` | Continuous Integration / workflow changes | Hidden from changelog, no version bump |
| `chore` | Maintenance tasks | Hidden from changelog, no version bump |
| `revert` | Reverting a previous commit | Included in changelog |

### Breaking Changes

To indicate a breaking change, add an exclamation mark `!` after the type/scope or include `BREAKING CHANGE:` in the description/footer:
```text
feat!: redesign message deletion automation engine
```
Breaking changes trigger a **MAJOR** version bump (e.g., 3.8.0 → 4.0.0).

### Examples

- `feat: add Messenger fixture testing`
- `fix(selectors): handle updated delete confirmation`
- `docs: document local fixture workflow`
- `ci: add actionlint workflow`
- `chore(deps): bump actions/checkout from 4 to 5`

---

## Release Process

> **Note for Maintainers:** Releases are **never** created manually. Do not create manual Git tags or manual GitHub Releases.

### Versioning & Chrome Web Store Semantics

- The previous release uploaded to the Chrome Web Store was version `3.8`.
- The repository baseline has been normalized to `3.8.0` (SemVer 2.0.0 requires `MAJOR.MINOR.PATCH`).
- Chrome Web Store parses version strings as dot-separated integers. The next automated release will be `3.8.1` (patch) or `3.9.0` (minor), both of which sort cleanly after `3.8` in CWS integer component comparison.
- Manifest `version` in [`manifest.json`](manifest.json) is the authoritative version and is kept synchronized automatically by Release Please.

1. As conventional PRs merge into `main`, GitHub Actions runs `.github/workflows/release-please.yml`.
2. Release Please reviews commits since the last release tag (or bootstrap boundary SHA) and opens or updates a **Release PR** (e.g. `chore(main): release 3.8.1`).
3. The Release PR automatically:
   - Computes the next SemVer version (`MAJOR.MINOR.PATCH`).
   - Generates the `CHANGELOG.md` entry grouped by Features, Bug Fixes, etc.
   - Synchronizes `"version"` in [`manifest.json`](manifest.json) via JSONPath `$.version`.
   - Updates [`.release-please-manifest.json`](.release-please-manifest.json).
4. When the maintainer merges the Release PR:
   - Release Please creates the corresponding Git tag (e.g., `v3.8.1`).
   - Release Please publishes the GitHub Release with the compiled changelog notes.
   - The authoritative version in [`manifest.json`](manifest.json) matches the release tag.

---

## Dependabot

Dependabot automatically monitors:
- **GitHub Actions** (`.github/workflows/*.yml`) weekly.
- **npm dependencies** (`package.json`) weekly.

Dependabot PRs use the Conventional Commit prefix `chore(deps):` and are grouped into single PRs to prevent dependency update noise.

---

## Local Development & Validation

Before pushing, verify your workflows, manifest, and tests locally:

### 1. Validate Production Manifest
Verify no development localhost matches are present:
```bash
npm run manifest:check
```

### 2. Validate & Update Fixture Model
Verify privacy guarantees and derive the normalized structural fixture model:
```bash
npm run fixture:validate
npm run fixture:generate
# or
npm run fixture:update
```

### 3. Run Actionlint
If [actionlint](https://github.com/rhysd/actionlint) is installed locally:
```bash
actionlint -color
```

### 4. Run Automated Playwright Tests
```bash
npm test
```
To run against the local mock Messenger server:
```bash
npm run serve:fixture
npm test
```
