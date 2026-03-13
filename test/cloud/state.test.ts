import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mock STATE_DIR to use a temp directory
let tmpDir: string;
vi.mock("../../src/shared/paths.js", () => ({
  get STATE_DIR() {
    return tmpDir;
  },
}));

import { loadState, saveState, deleteState, createState } from "../../src/cloud/state.js";
import type { ProvisionedState } from "../../src/cloud/state.js";

describe("cloud/state", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-state-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no state file exists", () => {
    expect(loadState("/some/project")).toBeNull();
  });

  it("saves and loads state", () => {
    const state = createState("/my/project", "ecs", [
      { type: "ecr-repo", id: "al-images" },
      { type: "ecs-cluster", id: "al-cluster" },
    ]);

    saveState(state);

    const loaded = loadState("/my/project");
    expect(loaded).not.toBeNull();
    expect(loaded!.projectPath).toBe("/my/project");
    expect(loaded!.provider).toBe("ecs");
    expect(loaded!.resources).toHaveLength(2);
    expect(loaded!.resources[0].type).toBe("ecr-repo");
  });

  it("deletes state", () => {
    const state = createState("/my/project", "cloud-run", []);
    saveState(state);
    expect(loadState("/my/project")).not.toBeNull();

    deleteState("/my/project");
    expect(loadState("/my/project")).toBeNull();
  });

  it("deleteState is a no-op for non-existent state", () => {
    expect(() => deleteState("/nonexistent")).not.toThrow();
  });

  it("different project paths produce different state files", () => {
    const state1 = createState("/project/a", "ecs", [{ type: "x", id: "1" }]);
    const state2 = createState("/project/b", "cloud-run", [{ type: "y", id: "2" }]);

    saveState(state1);
    saveState(state2);

    const loaded1 = loadState("/project/a");
    const loaded2 = loadState("/project/b");

    expect(loaded1!.provider).toBe("ecs");
    expect(loaded2!.provider).toBe("cloud-run");
  });

  it("updates updatedAt on save", () => {
    const state = createState("/my/project", "ecs", []);
    const originalUpdatedAt = state.updatedAt;

    // Small delay to ensure different timestamp
    state.updatedAt = "2000-01-01T00:00:00.000Z";
    saveState(state);

    const loaded = loadState("/my/project");
    expect(loaded!.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
  });
});
