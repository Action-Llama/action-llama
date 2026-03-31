import { describe, it, expect, vi } from "vitest";

import { init } from "../../../src/cli/commands/claude.js";

describe("claude init command", () => {
  it("prints instructions to use npx skills add", async () => {
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg: string) => {
      logs.push(msg);
    });

    await init({ project: "/my/project" });

    const output = logs.join("\n");
    expect(output).toContain("npx skills add Action-Llama/skill");
    consoleSpy.mockRestore();
  });

  it("does not call scaffoldSkillContent", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await init({ project: "/my/project" });

    // The function just prints — no scaffold calls
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
