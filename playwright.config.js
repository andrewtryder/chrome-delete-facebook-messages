const { defineConfig } = require("@playwright/test");

const PORT = process.env.PORT || 4174;

module.exports = defineConfig({
  testDir: "./test",
  testMatch: "**/*.spec.js",
  timeout: 20000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
  },
  webServer: {
    command: `PORT=${PORT} node test/serve-fixture.js`,
    port: Number(PORT),
    reuseExistingServer: false,
  },
});
