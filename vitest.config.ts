import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: ["**/node_modules/**", "**/.claude/worktrees/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/cli/main.ts",       // top-level script with process.exit
        "src/setup/prompts.ts",   // interactive TUI (inquirer prompts)
        "src/scheduler/types.ts", // pure type definitions
      ],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          exclude: ["**/node_modules/**", "**/.claude/worktrees/**", "test/integration/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          pool: "forks",
          testTimeout: 180_000,
        },
      },
    ],
  },
});
