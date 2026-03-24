import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "e2e",
    testTimeout: 600000, // 10 minutes per test
    hookTimeout: 300000, // 5 minutes for setup/teardown
    pool: "forks", // Isolate container tests
    setupFiles: ["./src/setup.ts"],
    globalSetup: ["./src/global-setup.ts"],
    include: ["src/tests/**/*.test.ts"],
  },
  pool: "forks", // Moved from test.pool (Vitest 4 compatibility)
  poolOptions: {
    forks: {
      singleFork: true, // Prevent parallel container conflicts
    },
  },
});