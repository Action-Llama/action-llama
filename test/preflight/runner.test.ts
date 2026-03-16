import { describe, it, expect, vi } from "vitest";
import { runPreflight } from "../../src/preflight/runner.js";
import type { PreflightStep, PreflightContext } from "../../src/preflight/schema.js";

// Mock the registry to inject fake providers
vi.mock("../../src/preflight/registry.js", () => ({
  resolvePreflightProvider: (id: string) => {
    if (id === "fail") {
      return {
        id: "fail",
        run: async () => { throw new Error("step failed"); },
      };
    }
    if (id === "ok") {
      return {
        id: "ok",
        run: async () => {},
      };
    }
    throw new Error(`Unknown preflight provider "${id}"`);
  },
}));

function makeCtx(): PreflightContext & { logs: Array<{ level: string; msg: string }> } {
  const logs: Array<{ level: string; msg: string }> = [];
  return {
    env: {},
    logger: (level, msg) => { logs.push({ level, msg }); },
    logs,
  };
}

describe("runPreflight", () => {
  it("runs all steps in order", async () => {
    const steps: PreflightStep[] = [
      { provider: "ok", params: {} },
      { provider: "ok", params: {} },
    ];
    const ctx = makeCtx();
    await runPreflight(steps, ctx);
    const infoLogs = ctx.logs.filter((l) => l.level === "info");
    expect(infoLogs.length).toBeGreaterThanOrEqual(3); // starting + 2 done
  });

  it("throws on required step failure", async () => {
    const steps: PreflightStep[] = [
      { provider: "fail", required: true, params: {} },
    ];
    const ctx = makeCtx();
    await expect(runPreflight(steps, ctx)).rejects.toThrow(/Required preflight step "fail" failed/);
  });

  it("required defaults to true", async () => {
    const steps: PreflightStep[] = [
      { provider: "fail", params: {} }, // required omitted → true
    ];
    const ctx = makeCtx();
    await expect(runPreflight(steps, ctx)).rejects.toThrow(/Required preflight step/);
  });

  it("continues past optional step failure", async () => {
    const steps: PreflightStep[] = [
      { provider: "fail", required: false, params: {} },
      { provider: "ok", params: {} },
    ];
    const ctx = makeCtx();
    await runPreflight(steps, ctx);
    const warnLogs = ctx.logs.filter((l) => l.level === "warn");
    expect(warnLogs.length).toBe(1);
    expect(warnLogs[0].msg).toMatch(/optional/);
  });

  it("handles empty steps array", async () => {
    const ctx = makeCtx();
    await runPreflight([], ctx);
    expect(ctx.logs.some((l) => l.msg.includes("preflight complete"))).toBe(true);
  });
});
