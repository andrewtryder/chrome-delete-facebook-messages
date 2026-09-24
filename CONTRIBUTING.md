# Contributing to Delete Facebook Messages

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
   - GitHub Actions automatically authenticates via Google Workload Identity Federation, packages the production extension, uploads the versioned archive to Chrome Web Store API v2, and submits it for review with `DEFAULT_PUBLISH`.

### Automated Chrome Web Store Publishing

The GitHub Actions release workflow (`.github/workflows/release-please.yml`) automatically uploads and submits production packages to the Chrome Web Store upon release creation.

#### Required GitHub Repository Variables
The following repository variables must be configured under **Settings > Secrets and variables > Actions > Variables**:

| Variable Name | Purpose | Example / Format |
|---|---|---|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full resource name of Google WIF provider | `projects/123456/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| `GCP_SERVICE_ACCOUNT` | Email of Google service account for CWS | `cws-publisher@project-id.iam.gserviceaccount.com` |
| `CWS_EXTENSION_ID` | Chrome Web Store Extension Item ID | `abcdefghijklmnopabcdefghijklmnop` |
| `CWS_PUBLISHER_ID` | Chrome Web Store Developer / Publisher ID | `pub-1234567890123456` |

#### Security & Operational Architecture
- **Keyless Authentication**: Authentication uses GitHub Actions OIDC tokens federated directly with Google Workload Identity Federation (`google-github-actions/auth`). No long-lived service account JSON key exists or should ever be generated.
- **Trigger Condition**: Publishing steps run **only** when a new release is actually published (`steps.release.outputs.releases_created == 'true'`), never during normal PR checks or standard commits to `main`.
- **Review & Publication**: Releases submit with `DEFAULT_PUBLISH` and `skipReview: false`. Google's automated/manual review process still takes place; once approved, the extension is published automatically without further manual intervention.
- **Local Environment Isolation**: Local development `.env` files are never referenced or read by GitHub Actions. Local `.env` files are ignored by git and must **never** be committed.

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
