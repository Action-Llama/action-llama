import { describe, it, expect, vi, beforeEach } from "vitest";
import { runHooks, type HookContext } from "../../src/hooks/runner.js";

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "child_process";
const mockExecSync = vi.mocked(execSync);

function makeCtx(): HookContext & { logs: Array<{ level: string; msg: string; data?: Record<string, any> }> } {
  const logs: Array<{ level: string; msg: string; data?: Record<string, any> }> = [];
  return {
    env: { PATH: "/usr/bin" },
    logger: (level, msg, data) => logs.push({ level, msg, data }),
    logs,
  };
}

describe("runHooks", () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  describe("with an empty commands array", () => {
    it("returns durationMs without calling execSync", async () => {
      const ctx = makeCtx();
      const result = await runHooks([], "pre", ctx);

      expect(result).toHaveProperty("durationMs");
      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it("logs starting and complete messages", async () => {
      const ctx = makeCtx();
      await runHooks([], "pre", ctx);

      expect(ctx.logs[0].level).toBe("info");
      expect(ctx.logs[0].msg).toContain("hooks.pre starting");
      expect(ctx.logs[0].data).toEqual({ count: 0 });

      expect(ctx.logs[ctx.logs.length - 1].level).toBe("info");
      expect(ctx.logs[ctx.logs.length - 1].msg).toContain("hooks.pre complete");
    });
  });

  describe("with successful commands", () => {
    it("calls execSync for each command", async () => {
      const ctx = makeCtx();
      mockExecSync.mockReturnValue(Buffer.from(""));

      await runHooks(["echo hello", "echo world"], "post", ctx);

      expect(mockExecSync).toHaveBeenCalledTimes(2);
      expect(mockExecSync).toHaveBeenNthCalledWith(1, "echo hello", expect.objectContaining({
        shell: "/bin/sh",
        env: ctx.env,
        cwd: "/tmp",
        timeout: 300_000,
      }));
      expect(mockExecSync).toHaveBeenNthCalledWith(2, "echo world", expect.objectContaining({
        shell: "/bin/sh",
      }));
    });

    it("logs an info message for each command", async () => {
      const ctx = makeCtx();
      mockExecSync.mockReturnValue(Buffer.from(""));

      await runHooks(["echo hello"], "pre", ctx);

      const cmdLog = ctx.logs.find(l => l.msg.includes("[1/1]"));
      expect(cmdLog).toBeDefined();
      expect(cmdLog!.level).toBe("info");
      expect(cmdLog!.msg).toContain("echo hello");
    });

    it("returns a numeric durationMs", async () => {
      const ctx = makeCtx();
      mockExecSync.mockReturnValue(Buffer.from(""));

      const result = await runHooks(["echo ok"], "post", ctx);

      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("logs complete with durationMs", async () => {
      const ctx = makeCtx();
      mockExecSync.mockReturnValue(Buffer.from(""));

      await runHooks(["echo ok"], "post", ctx);

      const completeLog = ctx.logs[ctx.logs.length - 1];
      expect(completeLog.msg).toContain("hooks.post complete");
      expect(completeLog.data).toHaveProperty("durationMs");
    });

    it("passes env from ctx to execSync", async () => {
      const ctx = makeCtx();
      ctx.env = { MY_VAR: "abc", PATH: "/usr/local/bin" };
      mockExecSync.mockReturnValue(Buffer.from(""));

      await runHooks(["echo $MY_VAR"], "pre", ctx);

      expect(mockExecSync).toHaveBeenCalledWith("echo $MY_VAR", expect.objectContaining({
        env: { MY_VAR: "abc", PATH: "/usr/local/bin" },
      }));
    });
  });

  describe("when a command fails", () => {
    it("throws an error with phase and command info", async () => {
      const ctx = makeCtx();
      const err = new Error("command not found");
      (err as any).stderr = Buffer.from("sh: bad-command: not found");
      mockExecSync.mockImplementation(() => { throw err; });

      await expect(runHooks(["bad-command"], "pre", ctx)).rejects.toThrow(
        "Hook pre command failed: bad-command"
      );
    });

    it("stops execution after the first failure", async () => {
      const ctx = makeCtx();
      const err = new Error("exit 1");
      (err as any).stderr = Buffer.from("error output");
      mockExecSync.mockImplementation(() => { throw err; });

      await expect(runHooks(["fail-cmd", "should-not-run"], "post", ctx)).rejects.toThrow();

      expect(mockExecSync).toHaveBeenCalledTimes(1);
    });

    it("logs an error message with truncated stderr", async () => {
      const ctx = makeCtx();
      const err = new Error("exit 1");
      (err as any).stderr = Buffer.from("some error detail");
      mockExecSync.mockImplementation(() => { throw err; });

      await expect(runHooks(["bad-cmd"], "pre", ctx)).rejects.toThrow();

      const errorLog = ctx.logs.find(l => l.level === "error");
      expect(errorLog).toBeDefined();
      expect(errorLog!.msg).toContain("hooks.pre");
      expect(errorLog!.msg).toContain("failed");
      expect(errorLog!.data).toHaveProperty("error");
      expect(errorLog!.data!.error).toContain("some error detail");
    });

    it("falls back to err.message when stderr is absent", async () => {
      const ctx = makeCtx();
      const err = new Error("timeout reached");
      mockExecSync.mockImplementation(() => { throw err; });

      await expect(runHooks(["slow-cmd"], "pre", ctx)).rejects.toThrow();

      const errorLog = ctx.logs.find(l => l.level === "error");
      expect(errorLog!.data!.error).toContain("timeout reached");
    });

    it("falls back to String(err) when thrown value has no stderr or message", async () => {
      const ctx = makeCtx();
      // Throw a non-Error primitive (no .stderr, no .message)
      mockExecSync.mockImplementation(() => { throw "plain-string-error"; });

      await expect(runHooks(["cmd"], "pre", ctx)).rejects.toThrow();

      const errorLog = ctx.logs.find(l => l.level === "error");
      expect(errorLog!.data!.error).toContain("plain-string-error");
    });
  });

  describe("phase label in logs", () => {
    it("uses 'pre' phase in log messages", async () => {
      const ctx = makeCtx();
      mockExecSync.mockReturnValue(Buffer.from(""));
      await runHooks(["echo"], "pre", ctx);
      expect(ctx.logs.some(l => l.msg.includes("hooks.pre"))).toBe(true);
    });

    it("uses 'post' phase in log messages", async () => {
      const ctx = makeCtx();
      mockExecSync.mockReturnValue(Buffer.from(""));
      await runHooks(["echo"], "post", ctx);
      expect(ctx.logs.some(l => l.msg.includes("hooks.post"))).toBe(true);
    });
  });

  describe("command label indexing", () => {
    it("logs [1/3], [2/3], [3/3] labels for three commands", async () => {
      const ctx = makeCtx();
      mockExecSync.mockReturnValue(Buffer.from(""));

      await runHooks(["cmd1", "cmd2", "cmd3"], "pre", ctx);

      expect(ctx.logs.some(l => l.msg.includes("[1/3]"))).toBe(true);
      expect(ctx.logs.some(l => l.msg.includes("[2/3]"))).toBe(true);
      expect(ctx.logs.some(l => l.msg.includes("[3/3]"))).toBe(true);
    });
  });
});
