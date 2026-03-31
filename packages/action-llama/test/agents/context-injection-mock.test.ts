/**
 * Additional context-injection tests using mocked execSync
 * to cover the fallback error path (`String(err)` when err has no stderr or message).
 */
import { describe, it, expect, vi } from "vitest";

const { mockExecSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execSync: mockExecSync };
});

const { processContextInjection } = await import("../../src/agents/context-injection.js");

describe("processContextInjection (mocked)", () => {
  it("falls back to String(err) when error has no stderr and no message", () => {
    // Throw a non-Error object (no .stderr, no .message)
    mockExecSync.mockImplementation(() => {
      throw "plain string error";
    });

    const result = processContextInjection("!`any-command`", {});
    expect(result).toMatch(/^\[Error: /);
    expect(result).toContain("plain string error");
  });

  it("falls back to err.message when err has no stderr property", () => {
    // Throw a regular Error with a message but no .stderr
    mockExecSync.mockImplementation(() => {
      const err = new Error("something went wrong without stderr");
      throw err;
    });

    const result = processContextInjection("!`any-command`", {});
    expect(result).toContain("[Error: something went wrong without stderr]");
  });

  it("uses stderr content when error has stderr", () => {
    mockExecSync.mockImplementation(() => {
      const err: any = new Error("Command failed");
      err.stderr = Buffer.from("detailed stderr output");
      throw err;
    });

    const result = processContextInjection("!`any-command`", {});
    expect(result).toContain("[Error: detailed stderr output]");
  });
});
