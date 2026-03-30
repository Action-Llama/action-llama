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
      },
      {
        extends: true,
        test: {
          name: "integration",
          testTimeout: 1_800_000,
          pool: "forks",
          include: ["src/integration/**/*.test.ts"],
        },
      },
    ],
  },
});
