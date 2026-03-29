import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "path";

const mockScaffoldClaudeCommands = vi.fn();

vi.mock("../../../src/setup/scaffold.js", () => ({
  scaffoldClaudeCommands: (...args: any[]) => mockScaffoldClaudeCommands(...args),
}));

import { init } from "../../../src/cli/commands/claude.js";

describe("claude init command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls scaffoldClaudeCommands with the resolved project path", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const projectArg = "/some/project";

    await init({ project: projectArg });

    expect(mockScaffoldClaudeCommands).toHaveBeenCalledWith(resolve(projectArg));
    consoleSpy.mockRestore();
  });

  it("resolves relative project paths before passing to scaffold", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await init({ project: "relative/path" });

    const expectedPath = resolve("relative/path");
    expect(mockScaffoldClaudeCommands).toHaveBeenCalledWith(expectedPath);
    consoleSpy.mockRestore();
  });

  it("logs a message indicating where commands were written", async () => {
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg: string) => {
      logs.push(msg);
    });

    await init({ project: "/my/project" });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(".claude/commands");
    consoleSpy.mockRestore();
  });

  it("log message includes the resolved project path", async () => {
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg: string) => {
      logs.push(msg);
    });

    await init({ project: "/my/project" });

    const expectedPath = resolve("/my/project", ".claude/commands/");
    expect(logs[0]).toContain(expectedPath);
    consoleSpy.mockRestore();
  });
});
