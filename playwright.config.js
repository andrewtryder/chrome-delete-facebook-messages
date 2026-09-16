const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./test",
  testMatch: "**/*.spec.js",
  timeout: 20000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
  },
  webServer: {
    command: "node test/serve-fixture.js",
    port: 4173,
    reuseExistingServer: true,
  },
});
