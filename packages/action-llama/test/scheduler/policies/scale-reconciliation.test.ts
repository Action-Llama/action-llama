import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  enforceProjectScaleCap,
  syncTrackerScales,
} from "../../../src/scheduler/policies/scale-reconciliation.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  } as any;
}

function makeAgentConfig(name: string, scale?: number) {
  return { name, scale } as any;
}

describe("enforceProjectScaleCap", () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  it("returns configs unchanged when no project scale cap is set", () => {
    const configs = [makeAgentConfig("a", 2), makeAgentConfig("b", 3)];
    const result = enforceProjectScaleCap(configs, {}, logger);
    expect(result[0].scale).toBe(2);
    expect(result[1].scale).toBe(3);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("does not mutate original config objects", () => {
    const configs = [makeAgentConfig("a", 5)];
    const original = configs[0];
    enforceProjectScaleCap(configs, { scale: 2 }, logger);
    expect(original.scale).toBe(5);
  });

  it("allocates full requested scale when capacity allows", () => {
    const configs = [makeAgentConfig("a", 2), makeAgentConfig("b", 3)];
    const result = enforceProjectScaleCap(configs, { scale: 10 }, logger);
    expect(result[0].scale).toBe(2);
    expect(result[1].scale).toBe(3);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("reduces agent scale when remaining capacity is smaller than requested", () => {
    const configs = [makeAgentConfig("a", 3), makeAgentConfig("b", 3)];
    const result = enforceProjectScaleCap(configs, { scale: 4 }, logger);
    expect(result[0].scale).toBe(3);
    expect(result[1].scale).toBe(1); // capped at remaining 1
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "b", requested: 3, reduced: 1 }),
      expect.any(String),
    );
  });

  it("pins agents to scale 1 when project capacity is exhausted", () => {
    const configs = [makeAgentConfig("a", 5), makeAgentConfig("b", 2)];
    const result = enforceProjectScaleCap(configs, { scale: 5 }, logger);
    expect(result[0].scale).toBe(5);
    expect(result[1].scale).toBe(1); // forced minimum
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "b", requested: 2, reduced: 1 }),
      expect.any(String),
    );
  });

  it("does not warn when pinned to 1 and requested scale was already 1", () => {
    const configs = [makeAgentConfig("a", 5), makeAgentConfig("b", 1)];
    const result = enforceProjectScaleCap(configs, { scale: 5 }, logger);
    expect(result[1].scale).toBe(1);
    // warn not called for agent b (requestedScale === 1 → no reduction message)
    const calls = logger.warn.mock.calls.filter((c: any[]) => c[0]?.agent === "b");
    expect(calls).toHaveLength(0);
  });

  it("warns about total requested scale exceeding cap when defaultAgentScale is set", () => {
    const configs = [makeAgentConfig("a"), makeAgentConfig("b")];
    const globalConfig = { scale: 3, defaultAgentScale: 2 } as any;
    enforceProjectScaleCap(configs, globalConfig, logger);
    // Logger is called with (obj, formatStr, ...args) — use a flexible check
    const warnCalls = logger.warn.mock.calls as any[][];
    const upfrontWarn = warnCalls.find((c) =>
      c[0] && typeof c[0] === "object" && c[0].totalRequested === 4 && c[0].projectScale === 3
    );
    expect(upfrontWarn).toBeDefined();
  });

  it("uses defaultAgentScale when agent.scale is undefined — second agent capped to remaining capacity", () => {
    const configs = [makeAgentConfig("a"), makeAgentConfig("b")];
    const globalConfig = { scale: 3, defaultAgentScale: 2 } as any;
    const result = enforceProjectScaleCap(configs, globalConfig, logger);
    // first agent's scale is unchanged (undefined → uses defaultAgentScale at pool creation time)
    // second agent is reduced to remaining capacity (3 - 2 = 1)
    expect(result[0].scale).toBeUndefined(); // unchanged, defaultAgentScale applied at pool creation
    expect(result[1].scale).toBe(1);
  });
});

describe("syncTrackerScales", () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  it("does nothing when statusTracker is undefined", () => {
    // Should not throw
    expect(() =>
      syncTrackerScales({ "agent-a": 2 }, undefined, logger)
    ).not.toThrow();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("updates tracker when actual scale differs from registered scale", () => {
    const statusTracker = {
      getAgentScale: vi.fn().mockReturnValue(3),
      updateAgentScale: vi.fn(),
    } as any;

    syncTrackerScales({ "agent-a": 2 }, statusTracker, logger);

    expect(statusTracker.updateAgentScale).toHaveBeenCalledWith("agent-a", 2);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-a", registeredScale: 3, actualScale: 2 }),
      expect.any(String),
    );
  });

  it("does not update tracker when actual scale matches registered scale", () => {
    const statusTracker = {
      getAgentScale: vi.fn().mockReturnValue(2),
      updateAgentScale: vi.fn(),
    } as any;

    syncTrackerScales({ "agent-a": 2 }, statusTracker, logger);

    expect(statusTracker.updateAgentScale).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("processes multiple agents independently", () => {
    const getAgentScale = vi.fn((name: string) => name === "a" ? 1 : 4);
    const updateAgentScale = vi.fn();
    const statusTracker = { getAgentScale, updateAgentScale } as any;

    syncTrackerScales({ a: 2, b: 4 }, statusTracker, logger);

    // "a" differs (1 vs 2) → updated
    expect(updateAgentScale).toHaveBeenCalledWith("a", 2);
    // "b" matches (4 vs 4) → not updated
    expect(updateAgentScale).not.toHaveBeenCalledWith("b", expect.anything());
  });
});
