import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "e2e",
          testTimeout: 600000, // 10 minutes per test
          hookTimeout: 300000, // 5 minutes for setup/teardown
          pool: "forks", // Isolate container tests
          maxWorkers: 1, // Run all test files in a single fork process (replaces singleFork)
          isolate: false,
          fileParallelism: false, // Prevent parallel test file execution — Docker builds conflict
          sequence: { groupOrder: 1 },
          setupFiles: ["./src/setup.ts"],
          globalSetup: ["./src/global-setup.ts"],
          include: ["src/tests/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          testTimeout: 1_800_000,
          pool: "forks",
          sequence: { groupOrder: 2 },
          include: ["src/integration/**/*.test.ts"],
        },
      },
    ],
  },
});
