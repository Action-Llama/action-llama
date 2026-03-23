import { defineConfig } from "@playwright/test";

const TEST_PORT = 8199;

export default defineConfig({
  testDir: "test/playwright",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${TEST_PORT}`,
    headless: true,
  },
  webServer: {
    command: "node test/playwright/test-server.mjs",
    port: TEST_PORT,
    reuseExistingServer: false,
    timeout: 15_000,
    env: {
      TEST_PORT: String(TEST_PORT),
    },
  },
});
