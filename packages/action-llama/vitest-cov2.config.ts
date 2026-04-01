import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: ["**/node_modules/**", "**/.claude/worktrees/**", "**/packages/e2e/**", "**/*.spec.ts", "**/al-bash-init*"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/cli/main.ts",
        "src/setup/prompts.ts",
        "src/scheduler/types.ts",
      ],
      reporter: ["json", "text"],
      reportsDirectory: "/tmp/coverage",
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          exclude: ["**/node_modules/**", "**/.claude/worktrees/**", "**/packages/e2e/**", "**/*.spec.ts", "**/al-bash-init*"],
        },
      },
    ],
  },
});
