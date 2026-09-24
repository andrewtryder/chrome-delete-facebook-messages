#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CWS_BASE_URL = "https://chromewebstore.googleapis.com";

/**
 * Builds Chrome Web Store API v2 endpoints.
 */
function buildEndpoints({ publisherId, extensionId }) {
  if (!publisherId || !extensionId) {
    throw new Error("Both publisherId and extensionId are required to construct API endpoints.");
  }
  return {
    uploadUrl: `${CWS_BASE_URL}/upload/v2/publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}:upload`,
    statusUrl: `${CWS_BASE_URL}/v2/publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}:fetchStatus`,
    publishUrl: `${CWS_BASE_URL}/v2/publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}:publish`,
  };
}

/**
 * Strips secret tokens from any string or error message.
 */
function sanitize(text, token) {
  if (!text) return "";
  const str = typeof text === "string" ? text : String(text);
  if (!token || typeof token !== "string" || token.trim() === "") {
    return str;
  }
  return str.replaceAll(token, "[REDACTED]");
}

/**
 * Formats diagnostic errors from HTTP responses, sanitizing any tokens.
 */
function formatHttpError(stage, status, statusText, bodyText, token) {
  let detail = bodyText || "";
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed.error) {
      detail = typeof parsed.error === "object" ? JSON.stringify(parsed.error) : parsed.error;
    } else if (parsed.itemError) {
      detail = JSON.stringify(parsed.itemError);
    } else {
      detail = JSON.stringify(parsed);
    }
  } catch {
    // Keep raw bodyText if not JSON
  }
  const cleanDetail = sanitize(detail, token);
  const cleanStatusText = sanitize(statusText, token);
  return new Error(
    `Chrome Web Store ${stage} failed (HTTP ${status} ${cleanStatusText}): ${cleanDetail || "No response body"}`
  );
}

/**
 * Extracts normalized upload state from response object.
 */
function extractUploadState(data) {
  if (!data || typeof data !== "object") return null;

  if (typeof data.uploadState === "string") {
    return data.uploadState.toUpperCase();
  }

  if (typeof data.lastAsyncUploadState === "string") {
    return data.lastAsyncUploadState.toUpperCase();
  }

  if (data.lastAsyncUploadState && typeof data.lastAsyncUploadState === "object") {
    if (typeof data.lastAsyncUploadState.uploadState === "string") {
      return data.lastAsyncUploadState.uploadState.toUpperCase();
    }
    if (typeof data.lastAsyncUploadState.state === "string") {
      return data.lastAsyncUploadState.state.toUpperCase();
    }
  }

  if (data.uploadResponse && typeof data.uploadResponse === "object") {
    if (typeof data.uploadResponse.uploadState === "string") {
      return data.uploadResponse.uploadState.toUpperCase();
    }
  }

  return null;
}

/**
 * Extracts crxVersion from upload or status response object.
 */
function extractCrxVersion(data) {
  if (!data || typeof data !== "object") return null;

  if (typeof data.crxVersion === "string" && data.crxVersion) {
    return data.crxVersion;
  }

  if (data.uploadResponse && typeof data.uploadResponse.crxVersion === "string" && data.uploadResponse.crxVersion) {
    return data.uploadResponse.crxVersion;
  }

  if (data.lastAsyncUploadState && typeof data.lastAsyncUploadState === "object") {
    if (typeof data.lastAsyncUploadState.crxVersion === "string" && data.lastAsyncUploadState.crxVersion) {
      return data.lastAsyncUploadState.crxVersion;
    }
  }

  if (typeof data.targetVersion === "string" && data.targetVersion) {
    return data.targetVersion;
  }

  return null;
}

/**
 * Extracts error details from upload or status response object.
 */
function extractErrors(data) {
  if (!data || typeof data !== "object") return null;
  const errors =
    data.itemError ||
    (data.lastAsyncUploadState && data.lastAsyncUploadState.itemError) ||
    (data.uploadResponse && data.uploadResponse.itemError) ||
    data.error;

  return errors ? JSON.stringify(errors) : null;
}

/**
 * Validates runtime inputs, files, and tokens.
 */
function validateInputs({
  zipPath,
  publisherId,
  extensionId,
  token,
  manifestPath,
  fsModule = fs,
}) {
  if (!token || typeof token !== "string" || token.trim() === "") {
    throw new Error("Missing required access token (CWS_ACCESS_TOKEN)");
  }
  if (!publisherId || typeof publisherId !== "string" || publisherId.trim() === "") {
    throw new Error("Missing required publisher ID (CWS_PUBLISHER_ID)");
  }
  if (!extensionId || typeof extensionId !== "string" || extensionId.trim() === "") {
    throw new Error("Missing required extension ID (CWS_EXTENSION_ID)");
  }
  if (!zipPath || typeof zipPath !== "string" || zipPath.trim() === "") {
    throw new Error("Missing required ZIP path (--zip)");
  }

  const resolvedZipPath = path.resolve(zipPath);
  if (!fsModule.existsSync(resolvedZipPath)) {
    throw new Error(`ZIP package not found: ${zipPath}`);
  }

  const stat = fsModule.statSync(resolvedZipPath);
  if (!stat.isFile()) {
    throw new Error(`ZIP path is not a regular file: ${zipPath}`);
  }
  if (stat.size === 0) {
    throw new Error(`ZIP package is empty (0 bytes): ${zipPath}`);
  }

  const resolvedManifestPath = manifestPath ? path.resolve(manifestPath) : path.resolve("manifest.json");
  if (!fsModule.existsSync(resolvedManifestPath)) {
    throw new Error(`manifest.json not found: ${resolvedManifestPath}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fsModule.readFileSync(resolvedManifestPath, "utf8"));
  } catch (err) {
    throw new Error(`Failed to parse manifest.json: ${err.message}`);
  }

  if (!manifest.version || typeof manifest.version !== "string") {
    throw new Error("manifest.json does not contain a valid string version");
  }

  return {
    expectedVersion: manifest.version,
    zipPath: resolvedZipPath,
    publisherId: publisherId.trim(),
    extensionId: extensionId.trim(),
    token: token.trim(),
  };
}

/**
 * Parses command-line arguments.
 */
function parseCommandLineArgs(argv = []) {
  const args = {
    zipPath: null,
    manifestPath: null,
    pollIntervalMs: 5000,
    maxPollMs: 120000,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--zip" && i + 1 < argv.length) {
      args.zipPath = argv[++i];
    } else if (arg.startsWith("--zip=")) {
      args.zipPath = arg.slice("--zip=".length);
    } else if (arg === "--manifest" && i + 1 < argv.length) {
      args.manifestPath = argv[++i];
    } else if (arg.startsWith("--manifest=")) {
      args.manifestPath = arg.slice("--manifest=".length);
    } else if (arg === "--poll-interval-ms" && i + 1 < argv.length) {
      args.pollIntervalMs = parseInt(argv[++i], 10);
    } else if (arg.startsWith("--poll-interval-ms=")) {
      args.pollIntervalMs = parseInt(arg.slice("--poll-interval-ms=".length), 10);
    } else if (arg === "--max-poll-ms" && i + 1 < argv.length) {
      args.maxPollMs = parseInt(argv[++i], 10);
    } else if (arg.startsWith("--max-poll-ms=")) {
      args.maxPollMs = parseInt(arg.slice("--max-poll-ms=".length), 10);
    }
  }

  return args;
}

/**
 * Core publish orchestrator.
 */
async function publishExtension({
  zipPath,
  publisherId,
  extensionId,
  token,
  manifestPath,
  pollIntervalMs = 5000,
  maxPollMs = 120000,
  fetchFn = globalThis.fetch,
  sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  fsModule = fs,
  logger = console,
}) {
  const validated = validateInputs({
    zipPath,
    publisherId,
    extensionId,
    token,
    manifestPath,
    fsModule,
  });

  const { expectedVersion } = validated;
  const endpoints = buildEndpoints({
    publisherId: validated.publisherId,
    extensionId: validated.extensionId,
  });

  logger.log(`📦 Preparing Chrome Web Store publication for extension ${validated.extensionId}...`);
  logger.log(`🎯 Expected version from manifest.json: ${expectedVersion}`);
  logger.log(`📁 Source package: ${validated.zipPath}`);

  const zipBytes = fsModule.readFileSync(validated.zipPath);

  // 1. Upload package
  logger.log(`🚀 Uploading package to Chrome Web Store API v2...`);
  let uploadRes;
  try {
    uploadRes = await fetchFn(endpoints.uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${validated.token}`,
        "Content-Type": "application/zip",
      },
      body: zipBytes,
    });
  } catch (err) {
    throw new Error(sanitize(`Upload network request failed: ${err.message}`, validated.token));
  }

  const uploadBodyText = await uploadRes.text().catch(() => "");
  if (!uploadRes.ok) {
    throw formatHttpError("upload", uploadRes.status, uploadRes.statusText, uploadBodyText, validated.token);
  }

  let uploadData;
  try {
    uploadData = JSON.parse(uploadBodyText);
  } catch {
    throw new Error("Chrome Web Store upload returned a non-JSON success response: " + sanitize(uploadBodyText, validated.token));
  }

  let uploadState = extractUploadState(uploadData);
  let crxVersion = extractCrxVersion(uploadData);

  logger.log(`📡 Initial upload state: ${uploadState || "UNKNOWN"}`);

  // 2. Poll fetchStatus if upload is asynchronous
  if (uploadState === "IN_PROGRESS" || uploadState === "UPLOAD_IN_PROGRESS" || (!uploadState && uploadRes.status === 202)) {
    logger.log(`⏳ Upload processing asynchronously; polling fetchStatus every ${pollIntervalMs}ms (max ${maxPollMs}ms)...`);
    const startTime = Date.now();
    let pollCount = 0;

    while (true) {
      await sleepFn(pollIntervalMs);
      pollCount++;

      let statusRes;
      try {
        statusRes = await fetchFn(endpoints.statusUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${validated.token}`,
            Accept: "application/json",
          },
        });
      } catch (err) {
        throw new Error(sanitize(`fetchStatus network request failed: ${err.message}`, validated.token));
      }

      const statusBodyText = await statusRes.text().catch(() => "");
      if (!statusRes.ok) {
        throw formatHttpError("fetchStatus", statusRes.status, statusRes.statusText, statusBodyText, validated.token);
      }

      let statusData;
      try {
        statusData = JSON.parse(statusBodyText);
      } catch {
        throw new Error("Chrome Web Store fetchStatus returned a non-JSON success response: " + sanitize(statusBodyText, validated.token));
      }

      uploadState = extractUploadState(statusData);
      const reportedVersion = extractCrxVersion(statusData);
      if (reportedVersion) {
        crxVersion = reportedVersion;
      }

      logger.log(`⏱️ [Poll #${pollCount}] Upload state: ${uploadState || "UNKNOWN"}`);

      if (uploadState === "SUCCEEDED") {
        logger.log("✅ Asynchronous upload succeeded.");
        break;
      }

      if (uploadState === "FAILED") {
        const errorDetail = extractErrors(statusData) || "Upload failed without specific error details.";
        throw new Error(`Chrome Web Store upload failed: ${sanitize(errorDetail, validated.token)}`);
      }

      if (uploadState === "NOT_FOUND") {
        throw new Error(`Chrome Web Store item not found (${validated.extensionId}). Verify CWS_EXTENSION_ID.`);
      }

      if (Date.now() - startTime >= maxPollMs) {
        throw new Error(`Chrome Web Store upload timed out after ${maxPollMs}ms (current state: ${uploadState || "UNKNOWN"}).`);
      }
    }
  } else if (uploadState === "SUCCEEDED") {
    logger.log("✅ Immediate upload succeeded.");
  } else if (uploadState === "FAILED") {
    const errorDetail = extractErrors(uploadData) || "Upload failed without specific error details.";
    throw new Error(`Chrome Web Store upload failed: ${sanitize(errorDetail, validated.token)}`);
  } else if (uploadState === "NOT_FOUND") {
    throw new Error(`Chrome Web Store item not found (${validated.extensionId}). Verify CWS_EXTENSION_ID.`);
  } else {
    throw new Error(`Chrome Web Store returned unhandled upload state: ${uploadState || "UNKNOWN"}`);
  }

  // 3. Verify version if available
  if (crxVersion) {
    logger.log(`🔍 Uploaded crxVersion: ${crxVersion} (manifest version: ${expectedVersion})`);
    if (crxVersion !== expectedVersion) {
      throw new Error(
        `Upload version mismatch: expected ${expectedVersion} from manifest, but Chrome Web Store reported ${crxVersion}. Aborting before publish.`
      );
    }
  } else {
    logger.log(`ℹ️ crxVersion not returned in upload/status response; proceeding with verified manifest version ${expectedVersion}.`);
  }

  // 4. Submit for publish
  logger.log(`📣 Submitting item for DEFAULT_PUBLISH (with review)...`);
  const publishPayload = {
    publishType: "DEFAULT_PUBLISH",
    skipReview: false,
  };

  let publishRes;
  try {
    publishRes = await fetchFn(endpoints.publishUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${validated.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(publishPayload),
    });
  } catch (err) {
    throw new Error(sanitize(`Publish network request failed: ${err.message}`, validated.token));
  }

  const publishBodyText = await publishRes.text().catch(() => "");
  if (!publishRes.ok) {
    throw formatHttpError("publish", publishRes.status, publishRes.statusText, publishBodyText, validated.token);
  }

  let publishData;
  try {
    publishData = JSON.parse(publishBodyText);
  } catch {
    throw new Error("Chrome Web Store publish returned a non-JSON success response: " + sanitize(publishBodyText, validated.token));
  }

  if (publishData.itemError || publishData.error) {
    const errText = extractErrors(publishData);
    throw new Error(`Chrome Web Store publish rejected: ${sanitize(errText, validated.token)}`);
  }

  // 5. Inspect warnings
  const warnings =
    publishData.warnings ||
    publishData.warning ||
    (Array.isArray(publishData.statusDetail)
      ? publishData.statusDetail.filter((d) => d && (d.warning || d.severity === "WARNING"))
      : null);

  if (warnings && (Array.isArray(warnings) ? warnings.length > 0 : true)) {
    logger.warn(`⚠️ Warning returned by Chrome Web Store publish: ${JSON.stringify(warnings)}`);
  }

  logger.log("");
  logger.log("============================================================");
  logger.log(`🎉 Successfully published extension version ${expectedVersion}!`);
  logger.log(`   Publisher ID : ${validated.publisherId}`);
  logger.log(`   Extension ID : ${validated.extensionId}`);
  logger.log(`   Publish Type : DEFAULT_PUBLISH (Automatic publication after Google review)`);
  if (warnings && (Array.isArray(warnings) ? warnings.length > 0 : true)) {
    logger.log(`   Warnings     : ${JSON.stringify(warnings)}`);
  }
  logger.log("============================================================");

  return {
    success: true,
    version: expectedVersion,
    crxVersion: crxVersion || expectedVersion,
    extensionId: validated.extensionId,
    publisherId: validated.publisherId,
    warnings: warnings || null,
    publishData,
  };
}

/**
 * Main CLI entry point.
 */
async function main(argv = process.argv.slice(2)) {
  const cliArgs = parseCommandLineArgs(argv);

  const token = process.env.CWS_ACCESS_TOKEN;
  const publisherId = process.env.CWS_PUBLISHER_ID;
  const extensionId = process.env.CWS_EXTENSION_ID;

  try {
    await publishExtension({
      zipPath: cliArgs.zipPath,
      manifestPath: cliArgs.manifestPath,
      pollIntervalMs: cliArgs.pollIntervalMs,
      maxPollMs: cliArgs.maxPollMs,
      token,
      publisherId,
      extensionId,
    });
  } catch (err) {
    const cleanMessage = sanitize(err.message, token);
    console.error(`❌ Publish failed: ${cleanMessage}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`❌ Fatal error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildEndpoints,
  sanitize,
  formatHttpError,
  extractUploadState,
  extractCrxVersion,
  extractErrors,
  validateInputs,
  parseCommandLineArgs,
  publishExtension,
  main,
};
