"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const WORKFLOW_PATH = path.join(ROOT, ".github/workflows/release-please.yml");
const SCRIPT_PATH = path.join(ROOT, "scripts/chrome-web-store-publish.js");
const GITIGNORE_PATH = path.join(ROOT, ".gitignore");
const ENV_PATH = path.join(ROOT, ".env");
const ENV_EXAMPLE_PATH = path.join(ROOT, ".env.example");

describe("Release Workflow and Security Guard Tests", () => {
  const workflowContent = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const scriptContent = fs.readFileSync(SCRIPT_PATH, "utf8");
  const gitignoreContent = fs.readFileSync(GITIGNORE_PATH, "utf8");

  test("release-please.yml includes id-token: write permission for WIF", () => {
    assert.match(
      workflowContent,
      /id-token:\s*write/,
      "release-please.yml must grant id-token: write for GitHub Actions OIDC"
    );
  });

  test("release-please.yml uses the pinned google-github-actions/auth SHA", () => {
    assert.match(
      workflowContent,
      /google-github-actions\/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093\s+#\s*v3/,
      "Must use immutable commit SHA 7c6bc770dae815cd3e89ee6cdf493a5fab2cc093 for google-github-actions/auth"
    );
  });

  test("release-please.yml references all required repository variables", () => {
    assert.ok(
      workflowContent.includes("vars.GCP_WORKLOAD_IDENTITY_PROVIDER"),
      "Must reference vars.GCP_WORKLOAD_IDENTITY_PROVIDER"
    );
    assert.ok(
      workflowContent.includes("vars.GCP_SERVICE_ACCOUNT"),
      "Must reference vars.GCP_SERVICE_ACCOUNT"
    );
    assert.ok(
      workflowContent.includes("vars.CWS_PUBLISHER_ID"),
      "Must reference vars.CWS_PUBLISHER_ID"
    );
    assert.ok(
      workflowContent.includes("vars.CWS_EXTENSION_ID"),
      "Must reference vars.CWS_EXTENSION_ID"
    );
  });

  test("release-please.yml only performs Chrome publishing when releases_created == 'true'", () => {
    const lines = workflowContent.split("\n");
    let inPublishStep = false;
    let foundReleaseConditionInAuth = false;
    let foundReleaseConditionInValidation = false;
    let foundReleaseConditionInPublish = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("name: Authenticate to Google Cloud")) {
        const nextLines = lines.slice(i, i + 5).join("\n");
        if (nextLines.includes("steps.release.outputs.releases_created == 'true'")) {
          foundReleaseConditionInAuth = true;
        }
      }
      if (line.includes("name: Validate Chrome Web Store")) {
        const nextLines = lines.slice(i, i + 5).join("\n");
        if (nextLines.includes("steps.release.outputs.releases_created == 'true'")) {
          foundReleaseConditionInValidation = true;
        }
      }
      if (line.includes("name: Publish extension to Chrome Web Store")) {
        inPublishStep = true;
        const nextLines = lines.slice(i, i + 5).join("\n");
        if (nextLines.includes("steps.release.outputs.releases_created == 'true'")) {
          foundReleaseConditionInPublish = true;
        }
      }
    }

    assert.ok(
      foundReleaseConditionInAuth,
      "Google Cloud authentication must only run when releases_created == 'true'"
    );
    assert.ok(
      foundReleaseConditionInValidation,
      "Chrome Web Store configuration validation must only run when releases_created == 'true'"
    );
    assert.ok(
      foundReleaseConditionInPublish,
      "Chrome Web Store publish step must only run when releases_created == 'true'"
    );
  });

  test("release-please.yml uses the chromewebstore OAuth scope", () => {
    assert.ok(
      workflowContent.includes("https://www.googleapis.com/auth/chromewebstore"),
      "Must configure https://www.googleapis.com/auth/chromewebstore scope"
    );
  });

  test("release-please.yml does not contain a service account private key", () => {
    assert.doesNotMatch(workflowContent, /BEGIN (RSA )?PRIVATE KEY/);
    assert.doesNotMatch(workflowContent, /private_key/i);
    assert.doesNotMatch(workflowContent, /credentials_json/i);
  });

  test("workflow and publish scripts use Chrome Web Store API v2 only, never v1", () => {
    assert.doesNotMatch(
      workflowContent,
      /chromewebstore\.googleapis\.com\/.*v1\b/,
      "Workflow must not reference CWS API v1"
    );
    assert.doesNotMatch(
      scriptContent,
      /chromewebstore\.googleapis\.com\/.*v1\b/,
      "Publish script must not reference CWS API v1"
    );
    assert.ok(
      scriptContent.includes("/upload/v2/publishers/"),
      "Upload endpoint must be v2"
    );
    assert.ok(
      scriptContent.includes("/v2/publishers/"),
      "Status and publish endpoints must be v2"
    );
  });

  test(".gitignore protects local .env and environment variants", () => {
    const lines = gitignoreContent.split("\n").map((l) => l.trim());
    assert.ok(lines.includes(".env"), ".gitignore must include .env");
    assert.ok(lines.includes(".env.*"), ".gitignore must include .env.*");
    assert.ok(lines.includes("!.env.example"), ".gitignore must exempt !.env.example");
  });

  test(".env.example exists and contains only empty placeholder variable names", () => {
    assert.ok(fs.existsSync(ENV_EXAMPLE_PATH), ".env.example must exist");
    const exampleContent = fs.readFileSync(ENV_EXAMPLE_PATH, "utf8");
    const expectedPlaceholders = [
      "GCP_WORKLOAD_IDENTITY_PROVIDER=",
      "GCP_SERVICE_ACCOUNT=",
      "CWS_EXTENSION_ID=",
      "CWS_PUBLISHER_ID=",
    ];
    for (const placeholder of expectedPlaceholders) {
      assert.ok(
        exampleContent.includes(placeholder),
        `.env.example must include ${placeholder}`
      );
    }

    // Verify no secret values are in .env.example
    const lines = exampleContent
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    for (const line of lines) {
      const parts = line.split("=");
      assert.equal(
        parts[1] || "",
        "",
        `.env.example line '${line}' must have an empty placeholder value`
      );
    }
  });

  test("Local .env values are never hard-coded or committed into workflow or codebase", () => {
    if (!fs.existsSync(ENV_PATH)) return;

    const envContent = fs.readFileSync(ENV_PATH, "utf8");
    const lines = envContent
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("="));

    for (const line of lines) {
      const [key, ...rest] = line.split("=");
      const val = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
      if (val.length > 5) {
        assert.equal(
          workflowContent.includes(val),
          false,
          `Local .env value for ${key} must not appear in release-please.yml!`
        );
        assert.equal(
          scriptContent.includes(val),
          false,
          `Local .env value for ${key} must not appear in chrome-web-store-publish.js!`
        );
      }
    }
  });

  test("chrome-web-store-smoke-test.yml is correctly configured and read-only", () => {
    const smokePath = path.join(ROOT, ".github/workflows/chrome-web-store-smoke-test.yml");
    assert.ok(fs.existsSync(smokePath), "chrome-web-store-smoke-test.yml must exist");
    const smokeContent = fs.readFileSync(smokePath, "utf8");

    assert.match(smokeContent, /id-token:\s*write/, "Smoke test workflow must include id-token: write");
    assert.match(smokeContent, /contents:\s*read/, "Smoke test workflow must have contents: read");
    assert.match(
      smokeContent,
      /google-github-actions\/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093\s+#\s*v3/,
      "Smoke test workflow must use pinned auth action"
    );
    assert.ok(smokeContent.includes("vars.GCP_WORKLOAD_IDENTITY_PROVIDER"));
    assert.ok(smokeContent.includes("vars.GCP_SERVICE_ACCOUNT"));
    assert.ok(smokeContent.includes("vars.CWS_PUBLISHER_ID"));
    assert.ok(smokeContent.includes("vars.CWS_EXTENSION_ID"));
    assert.ok(smokeContent.includes(":fetchStatus"), "Smoke test must call read-only :fetchStatus");
    assert.doesNotMatch(smokeContent, /:upload\b/, "Smoke test must not call :upload");
    assert.doesNotMatch(smokeContent, /:publish\b/, "Smoke test must not call :publish");
  });
});
