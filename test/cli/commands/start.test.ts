import { describe, it, expect, vi } from "vitest";

// Mock config to return a minimal global config
vi.mock("../../../src/shared/config.js", async () => {
  const actual = await vi.importActual("../../../src/shared/config.js") as any;
  return {
    ...actual,
    loadGlobalConfig: vi.fn().mockReturnValue({}),
  };
});

// Mock doctor to be a no-op
vi.mock("../../../src/cli/commands/doctor.js", () => ({
  execute: vi.fn().mockResolvedValue(undefined),
}));

// Mock the scheduler to not actually start
vi.mock("../../../src/scheduler/index.js", () => ({
  startScheduler: vi.fn().mockResolvedValue({
    cronJobs: [1, 2, 3],
    runners: {},
  }),
}));

// Mock TUI render to avoid React dependency in unit tests
vi.mock("../../../src/tui/render.js", () => ({
  renderTUI: vi.fn().mockResolvedValue({ unmount: vi.fn() }),
}));

import { execute } from "../../../src/cli/commands/start.js";
import { startScheduler } from "../../../src/scheduler/index.js";
import { StatusTracker } from "../../../src/tui/status-tracker.js";

describe("start", () => {
  it("calls startScheduler with StatusTracker and renders TUI", async () => {
    const promise = execute({ project: "/tmp/test" });

    // Give it a tick to start
    await new Promise((r) => setTimeout(r, 50));

    expect(startScheduler).toHaveBeenCalledWith(
      expect.stringContaining("test"),
      expect.any(Object),
      expect.any(StatusTracker),
      false,  // cloudMode = !!globalConfig.cloud = false
      undefined,
      undefined
    );

    // We can't await the promise since it never resolves, so just verify it started
  });
});
