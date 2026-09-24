"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildEndpoints,
  sanitize,
  formatHttpError,
  extractUploadState,
  extractCrxVersion,
  extractErrors,
  validateInputs,
  parseCommandLineArgs,
  publishExtension,
} = require("../../scripts/chrome-web-store-publish.js");

function createMockFs({
  zipExists = true,
  zipIsFile = true,
  zipSize = 1024,
  manifestExists = true,
  manifestContent = JSON.stringify({ version: "3.10.2" }),
} = {}) {
  return {
    existsSync(p) {
      if (p.includes("manifest.json")) return manifestExists;
      return zipExists;
    },
    statSync(p) {
      return {
        isFile() {
          return zipIsFile;
        },
        size: zipSize,
      };
    },
    readFileSync(p) {
      if (p.includes("manifest.json")) return manifestContent;
      return Buffer.from("PK-fake-zip-binary-bytes");
    },
  };
}

function createMockLogger() {
  const logs = [];
  const warns = [];
  const errors = [];
  return {
    logs,
    warns,
    errors,
    log: (...args) => logs.push(args.join(" ")),
    warn: (...args) => warns.push(args.join(" ")),
    error: (...args) => errors.push(args.join(" ")),
  };
}

describe("Chrome Web Store Publish Client Unit Tests", () => {
  // 1. endpoint construction
  test("1. endpoint construction generates valid v2 endpoints and handles encoding", () => {
    const endpoints = buildEndpoints({
      publisherId: "pub-123",
      extensionId: "ext-456",
    });

    assert.equal(
      endpoints.uploadUrl,
      "https://chromewebstore.googleapis.com/upload/v2/publishers/pub-123/items/ext-456:upload"
    );
    assert.equal(
      endpoints.statusUrl,
      "https://chromewebstore.googleapis.com/v2/publishers/pub-123/items/ext-456:fetchStatus"
    );
    assert.equal(
      endpoints.publishUrl,
      "https://chromewebstore.googleapis.com/v2/publishers/pub-123/items/ext-456:publish"
    );

    // Verify rejection if publisherId or extensionId missing
    assert.throws(
      () => buildEndpoints({ publisherId: "", extensionId: "ext" }),
      /Both publisherId and extensionId are required/
    );
    assert.throws(
      () => buildEndpoints({ publisherId: "pub", extensionId: "" }),
      /Both publisherId and extensionId are required/
    );
  });

  // 2. missing access token
  test("2. missing access token throws an informative error", async () => {
    await assert.rejects(
      () =>
        publishExtension({
          zipPath: "dist/ext.zip",
          publisherId: "pub-123",
          extensionId: "ext-123",
          token: "",
          fsModule: createMockFs(),
        }),
      /Missing required access token \(CWS_ACCESS_TOKEN\)/
    );
  });

  // 3. missing publisher ID
  test("3. missing publisher ID throws an informative error", async () => {
    await assert.rejects(
      () =>
        publishExtension({
          zipPath: "dist/ext.zip",
          publisherId: "",
          extensionId: "ext-123",
          token: "token-123",
          fsModule: createMockFs(),
        }),
      /Missing required publisher ID \(CWS_PUBLISHER_ID\)/
    );
  });

  // 4. missing extension ID
  test("4. missing extension ID throws an informative error", async () => {
    await assert.rejects(
      () =>
        publishExtension({
          zipPath: "dist/ext.zip",
          publisherId: "pub-123",
          extensionId: "  ",
          token: "token-123",
          fsModule: createMockFs(),
        }),
      /Missing required extension ID \(CWS_EXTENSION_ID\)/
    );
  });

  // 5. missing ZIP
  test("5. missing ZIP package throws an informative error", async () => {
    await assert.rejects(
      () =>
        publishExtension({
          zipPath: "dist/non-existent.zip",
          publisherId: "pub-123",
          extensionId: "ext-123",
          token: "token-123",
          fsModule: createMockFs({ zipExists: false }),
        }),
      /ZIP package not found/
    );
  });

  // 6. empty ZIP
  test("6. empty ZIP package throws an informative error", async () => {
    await assert.rejects(
      () =>
        publishExtension({
          zipPath: "dist/empty.zip",
          publisherId: "pub-123",
          extensionId: "ext-123",
          token: "token-123",
          fsModule: createMockFs({ zipSize: 0 }),
        }),
      /ZIP package is empty \(0 bytes\)/
    );
  });

  // 7. immediate upload success -> publish called
  test("7. immediate upload success -> publish called successfully", async () => {
    const fetchCalls = [];
    const mockFetch = async (url, options) => {
      fetchCalls.push({ url, options });
      if (url.includes(":upload")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ uploadState: "SUCCEEDED", crxVersion: "3.10.2" }),
        };
      }
      if (url.includes(":publish")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ status: ["OK"] }),
        };
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    const logger = createMockLogger();
    const result = await publishExtension({
      zipPath: "dist/ext.zip",
      publisherId: "pub-1",
      extensionId: "ext-1",
      token: "secret-token",
      fsModule: createMockFs(),
      fetchFn: mockFetch,
      logger,
    });

    assert.equal(result.success, true);
    assert.equal(result.version, "3.10.2");
    assert.equal(fetchCalls.length, 2);
    assert.ok(fetchCalls[0].url.includes(":upload"));
    assert.equal(fetchCalls[0].options.headers["Authorization"], "Bearer secret-token");
    assert.equal(fetchCalls[0].options.headers["Content-Type"], "application/zip");
    assert.ok(fetchCalls[1].url.includes(":publish"));
    assert.equal(fetchCalls[1].options.headers["Authorization"], "Bearer secret-token");
  });

  // 8. upload response version matches expected version
  test("8. upload response version matches expected manifest version", async () => {
    const mockFetch = async (url) => {
      if (url.includes(":upload")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ uploadState: "SUCCEEDED", crxVersion: "3.10.2" }),
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ status: ["OK"] }),
      };
    };

    const result = await publishExtension({
      zipPath: "dist/ext.zip",
      publisherId: "pub-1",
      extensionId: "ext-1",
      token: "token-1",
      fsModule: createMockFs({ manifestContent: JSON.stringify({ version: "3.10.2" }) }),
      fetchFn: mockFetch,
      logger: createMockLogger(),
    });

    assert.equal(result.crxVersion, "3.10.2");
    assert.equal(result.version, "3.10.2");
  });

  // 9. upload version mismatch -> abort; publish not called
  test("9. upload version mismatch aborts before publish is called", async () => {
    const fetchCalls = [];
    const mockFetch = async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ uploadState: "SUCCEEDED", crxVersion: "3.9.9" }),
      };
    };

    await assert.rejects(
      () =>
        publishExtension({
          zipPath: "dist/ext.zip",
          publisherId: "pub-1",
          extensionId: "ext-1",
          token: "token-1",
          fsModule: createMockFs({ manifestContent: JSON.stringify({ version: "3.10.2" }) }),
          fetchFn: mockFetch,
          logger: createMockLogger(),
        }),
      /Upload version mismatch: expected 3.10.2 from manifest, but Chrome Web Store reported 3.9.9/
    );

    // Verify publish was NEVER called
    assert.equal(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.includes(":upload"));
  });

  // 10. asynchronous upload: IN_PROGRESS -> SUCCEEDED -> publish
  test("10. asynchronous upload: IN_PROGRESS -> SUCCEEDED -> publish", async () => {
    let pollCount = 0;
    const fetchCalls = [];
    const sleeps = [];

    const mockFetch = async (url, options) => {
      fetchCalls.push({ url, options });
      if (url.includes(":upload")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ uploadState: "IN_PROGRESS" }),
        };
      }
      if (url.includes(":fetchStatus")) {
        pollCount++;
        if (pollCount === 1) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () => JSON.stringify({ lastAsyncUploadState: "IN_PROGRESS" }),
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              lastAsyncUploadState: { uploadState: "SUCCEEDED", crxVersion: "3.10.2" },
            }),
        };
      }
      if (url.includes(":publish")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ status: ["OK"] }),
        };
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    const result = await publishExtension({
      zipPath: "dist/ext.zip",
      publisherId: "pub-1",
      extensionId: "ext-1",
      token: "token-1",
      pollIntervalMs: 50,
      maxPollMs: 1000,
      fsModule: createMockFs(),
      fetchFn: mockFetch,
      sleepFn: async (ms) => sleeps.push(ms),
      logger: createMockLogger(),
    });

    assert.equal(result.success, true);
    assert.equal(fetchCalls.length, 4); // upload, status 1, status 2, publish
    assert.equal(sleeps.length, 2);
    assert.equal(sleeps[0], 50);
    assert.ok(fetchCalls[1].url.includes(":fetchStatus"));
    assert.ok(fetchCalls[2].url.includes(":fetchStatus"));
    assert.ok(fetchCalls[3].url.includes(":publish"));
  });

  // 11. async upload failure: IN_PROGRESS -> FAILED -> abort
  test("11. async upload failure: IN_PROGRESS -> FAILED -> aborts without calling publish", async () => {
    const fetchCalls = [];
    const mockFetch = async (url, options) => {
      fetchCalls.push({ url, options });
      if (url.includes(":upload")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ uploadState: "IN_PROGRESS" }),
        };
      }
      if (url.includes(":fetchStatus")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              uploadState: "FAILED",
              itemError: [{ error_code: "MANIFEST_INVALID", error_detail: "Invalid manifest" }],
            }),
        };
      }
      if (url.includes(":publish")) {
        throw new Error("Publish must never be called!");
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    await assert.rejects(
      () =>
        publishExtension({
          zipPath: "dist/ext.zip",
          publisherId: "pub-1",
          extensionId: "ext-1",
          token: "token-1",
          pollIntervalMs: 10,
          maxPollMs: 500,
          fsModule: createMockFs(),
          fetchFn: mockFetch,
          sleepFn: async () => {},
          logger: createMockLogger(),
        }),
      /Chrome Web Store upload failed.*MANIFEST_INVALID/
    );

    assert.equal(fetchCalls.length, 2);
    assert.ok(!fetchCalls.some((c) => c.url.includes(":publish")));
  });

  // 12. async polling timeout -> abort
  test("12. async polling timeout aborts without calling publish", async () => {
    const fetchCalls = [];
    const mockFetch = async (url, options) => {
      fetchCalls.push({ url, options });
      if (url.includes(":upload")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ uploadState: "IN_PROGRESS" }),
        };
      }
      if (url.includes(":fetchStatus")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ uploadState: "IN_PROGRESS" }),
        };
      }
      throw new Error("Publish must never be called!");
    };

    let simulatedTime = 0;
    const mockSleep = async (ms) => {
      simulatedTime += ms;
    };
    const realDateNow = Date.now;
    Date.now = () => 1000 + simulatedTime;

    try {
      await assert.rejects(
        () =>
          publishExtension({
            zipPath: "dist/ext.zip",
            publisherId: "pub-1",
            extensionId: "ext-1",
            token: "token-1",
            pollIntervalMs: 100,
            maxPollMs: 300,
            fsModule: createMockFs(),
            fetchFn: mockFetch,
            sleepFn: mockSleep,
            logger: createMockLogger(),
          }),
        /Chrome Web Store upload timed out after 300ms/
      );
    } finally {
      Date.now = realDateNow;
    }

    assert.ok(!fetchCalls.some((c) => c.url.includes(":publish")));
  });

  // 13. non-2xx upload response -> useful failure
  test("13. non-2xx upload response throws useful failure and does not call publish", async () => {
    const fetchCalls = [];
    const mockFetch = async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () =>
          JSON.stringify({
            error: { code: 400, message: "Archive format is not valid ZIP" },
          }),
      };
    };

    await assert.rejects(
      () =>
        publishExtension({
          zipPath: "dist/ext.zip",
          publisherId: "pub-1",
          extensionId: "ext-1",
          token: "token-1",
          fsModule: createMockFs(),
          fetchFn: mockFetch,
          logger: createMockLogger(),
        }),
      /Chrome Web Store upload failed \(HTTP 400 Bad Request\):.*Archive format is not valid ZIP/
    );

    assert.equal(fetchCalls.length, 1);
  });

  // 14. non-2xx fetchStatus response -> useful failure
  test("14. non-2xx fetchStatus response throws useful failure and does not call publish", async () => {
    const fetchCalls = [];
    const mockFetch = async (url, options) => {
      fetchCalls.push({ url, options });
      if (url.includes(":upload")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ uploadState: "IN_PROGRESS" }),
        };
      }
      return {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: async () => "Backend service temporarily overloaded",
      };
    };

    await assert.rejects(
      () =>
        publishExtension({
          zipPath: "dist/ext.zip",
          publisherId: "pub-1",
          extensionId: "ext-1",
          token: "token-1",
          pollIntervalMs: 10,
          fsModule: createMockFs(),
          fetchFn: mockFetch,
          sleepFn: async () => {},
          logger: createMockLogger(),
        }),
      /Chrome Web Store fetchStatus failed \(HTTP 503 Service Unavailable\): Backend service temporarily overloaded/
    );

    assert.equal(fetchCalls.length, 2);
  });

  // 15. non-2xx publish response -> useful failure
  test("15. non-2xx publish response throws useful failure", async () => {
    const mockFetch = async (url) => {
      if (url.includes(":upload")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ uploadState: "SUCCEEDED" }),
        };
      }
      return {
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () =>
          JSON.stringify({
            error: { code: 403, message: "Caller does not have permission to publish" },
          }),
      };
    };

    await assert.rejects(
      () =>
        publishExtension({
          zipPath: "dist/ext.zip",
          publisherId: "pub-1",
          extensionId: "ext-1",
          token: "token-1",
          fsModule: createMockFs(),
          fetchFn: mockFetch,
          logger: createMockLogger(),
        }),
      /Chrome Web Store publish failed \(HTTP 403 Forbidden\):.*Caller does not have permission to publish/
    );
  });

  // 16. malformed/non-JSON error body handling
  test("16. malformed / non-JSON error body is handled gracefully without JSON parse crash", () => {
    const htmlBody = "<html><head><title>502 Bad Gateway</title></head><body>502 Bad Gateway</body></html>";
    const err = formatHttpError("upload", 502, "Bad Gateway", htmlBody, "my-token");

    assert.ok(err.message.includes("HTTP 502 Bad Gateway"));
    assert.ok(err.message.includes("502 Bad Gateway"));
  });

  // 17. authentication token never appears in thrown/logged errors
  test("17. authentication token never appears in thrown or logged errors", async () => {
    const sensitiveToken = "ya29.sensitive-super-secret-token-value-12345";
    const mockFetch = async () => {
      return {
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => `Token invalid: ${sensitiveToken}`,
      };
    };

    const logger = createMockLogger();
    let thrownError;
    try {
      await publishExtension({
        zipPath: "dist/ext.zip",
        publisherId: "pub-1",
        extensionId: "ext-1",
        token: sensitiveToken,
        fsModule: createMockFs(),
        fetchFn: mockFetch,
        logger,
      });
    } catch (err) {
      thrownError = err;
    }

    assert.ok(thrownError, "Expected publishExtension to throw");
    assert.equal(thrownError.message.includes(sensitiveToken), false, "Token leaked in error message!");
    assert.ok(thrownError.message.includes("[REDACTED]"), "Token should be replaced by [REDACTED]");

    if (thrownError.stack) {
      assert.equal(thrownError.stack.includes(sensitiveToken), false, "Token leaked in error stack!");
    }

    // Verify all logger output is clean
    const allLogs = [...logger.logs, ...logger.warns, ...logger.errors].join("\n");
    assert.equal(allLogs.includes(sensitiveToken), false, "Token leaked in logger output!");
  });

  // 18. publish is never called before upload succeeds
  test("18. publish is never called before upload succeeds (on NOT_FOUND)", async () => {
    const fetchCalls = [];
    const mockFetch = async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ uploadState: "NOT_FOUND" }),
      };
    };

    await assert.rejects(
      () =>
        publishExtension({
          zipPath: "dist/ext.zip",
          publisherId: "pub-1",
          extensionId: "ext-missing",
          token: "token-1",
          fsModule: createMockFs(),
          fetchFn: mockFetch,
          logger: createMockLogger(),
        }),
      /Chrome Web Store item not found/
    );

    assert.equal(fetchCalls.length, 1);
    assert.ok(!fetchCalls.some((c) => c.url.includes(":publish")));
  });

  // 19. DEFAULT_PUBLISH request is generated correctly
  test("19. DEFAULT_PUBLISH request is generated correctly with explicit parameters", async () => {
    let capturedPublishBody = null;
    let capturedPublishHeaders = null;

    const mockFetch = async (url, options) => {
      if (url.includes(":upload")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ uploadState: "SUCCEEDED" }),
        };
      }
      if (url.includes(":publish")) {
        capturedPublishBody = JSON.parse(options.body);
        capturedPublishHeaders = options.headers;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ status: ["OK"] }),
        };
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    await publishExtension({
      zipPath: "dist/ext.zip",
      publisherId: "pub-xyz",
      extensionId: "ext-abc",
      token: "test-auth-token",
      fsModule: createMockFs(),
      fetchFn: mockFetch,
      logger: createMockLogger(),
    });

    assert.deepEqual(capturedPublishBody, {
      publishType: "DEFAULT_PUBLISH",
      skipReview: false,
    });
    assert.equal(capturedPublishHeaders["Content-Type"], "application/json");
    assert.equal(capturedPublishHeaders["Authorization"], "Bearer test-auth-token");
  });

  // 20. warnings returned by publish are surfaced in logs/result without being treated as success silently
  test("20. warnings returned by publish are surfaced in logs and result", async () => {
    const logger = createMockLogger();
    const warningsList = [
      { warning: "DEPRECATION_WARNING", message: "Consider updating permission usage" },
    ];

    const mockFetch = async (url) => {
      if (url.includes(":upload")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ uploadState: "SUCCEEDED" }),
        };
      }
      if (url.includes(":publish")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ status: ["OK"], warnings: warningsList }),
        };
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    const result = await publishExtension({
      zipPath: "dist/ext.zip",
      publisherId: "pub-1",
      extensionId: "ext-1",
      token: "token-1",
      fsModule: createMockFs(),
      fetchFn: mockFetch,
      logger,
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.warnings, warningsList);

    // Verify warnings were surfaced to logger.warn
    assert.ok(logger.warns.length > 0, "Expected logger.warn to be called with warnings");
    assert.ok(logger.warns[0].includes("DEPRECATION_WARNING"));
  });

  // Additional CLI argument parsing test
  test("parseCommandLineArgs parses zip, manifest, and polling flags", () => {
    const args1 = parseCommandLineArgs([
      "--zip",
      "dist/ext-1.0.0.zip",
      "--poll-interval-ms",
      "2000",
      "--max-poll-ms",
      "60000",
    ]);
    assert.equal(args1.zipPath, "dist/ext-1.0.0.zip");
    assert.equal(args1.pollIntervalMs, 2000);
    assert.equal(args1.maxPollMs, 60000);

    const args2 = parseCommandLineArgs([
      "--zip=dist/ext-2.0.0.zip",
      "--manifest=manifest.json",
      "--poll-interval-ms=1000",
      "--max-poll-ms=30000",
    ]);
    assert.equal(args2.zipPath, "dist/ext-2.0.0.zip");
    assert.equal(args2.manifestPath, "manifest.json");
    assert.equal(args2.pollIntervalMs, 1000);
    assert.equal(args2.maxPollMs, 30000);
  });
});
