import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "e2e",
    testTimeout: 600000, // 10 minutes per test
    hookTimeout: 120000, // 2 minutes for setup/teardown
    pool: "forks", // Isolate container tests
    poolOptions: {
      forks: {
        singleFork: true, // Prevent parallel container conflicts
      },
    },
    setupFiles: ["./src/setup.ts"],
    globalSetup: ["./src/global-setup.ts"],
    include: ["src/tests/**/*.test.ts"],
  },
});