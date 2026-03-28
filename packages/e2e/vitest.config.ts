import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "e2e",
    testTimeout: 600000, // 10 minutes per test
    hookTimeout: 300000, // 5 minutes for setup/teardown
    pool: "forks", // Isolate container tests
    poolOptions: {
      forks: {
        singleFork: true, // Run all test files in a single fork process
      },
    },
    fileParallelism: false, // Prevent parallel test file execution — Docker builds conflict
    setupFiles: ["./src/setup.ts"],
    globalSetup: ["./src/global-setup.ts"],
    include: ["src/tests/**/*.test.ts"],
  },
});