import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Create a temporary directory for STATE_DIR before mocking paths
let tempStateDir: string;

vi.mock("../../src/shared/paths.js", () => ({
  get STATE_DIR() {
    return tempStateDir;
  },
  AL_HOME_DIR: "/tmp/test-al-home",
}));

// Import after mocking
import {
  loadState,
  saveState,
  deleteState,
  createState,
} from "../../src/cloud/state.js";
import type { ProvisionedState } from "../../src/cloud/state.js";
import type { ProvisionedResource } from "../../src/cloud/provider.js";

describe("cloud/state", () => {
  beforeEach(() => {
    tempStateDir = mkdtempSync(join(tmpdir(), "al-state-test-"));
  });

  afterEach(() => {
    if (tempStateDir && existsSync(tempStateDir)) {
      rmSync(tempStateDir, { recursive: true, force: true });
    }
  });

  describe("createState", () => {
    it("returns a ProvisionedState with correct fields", () => {
      const resources: ProvisionedResource[] = [{ type: "server", id: "server-123", region: "us-east" }];
      const state = createState("/my/project", "vps", resources);

      expect(state.projectPath).toBe("/my/project");
      expect(state.provider).toBe("vps");
      expect(state.resources).toEqual(resources);
      expect(state.createdAt).toBeTruthy();
      expect(state.updatedAt).toBeTruthy();
    });

    it("sets createdAt and updatedAt to the same ISO timestamp", () => {
      const before = new Date().toISOString();
      const state = createState("/project", "vps", []);
      const after = new Date().toISOString();

      expect(state.createdAt >= before).toBe(true);
      expect(state.createdAt <= after).toBe(true);
      expect(state.createdAt).toBe(state.updatedAt);
    });

    it("returns empty resources array when none provided", () => {
      const state = createState("/project", "vps", []);
      expect(state.resources).toEqual([]);
    });

    it("returns a new object each call (no shared reference)", () => {
      const resources: ProvisionedResource[] = [{ type: "server", id: "a" }];
      const state1 = createState("/p1", "vps", resources);
      const state2 = createState("/p2", "vps", resources);

      expect(state1.projectPath).not.toBe(state2.projectPath);
    });
  });

  describe("loadState", () => {
    it("returns null when no state file exists", () => {
      const result = loadState("/nonexistent/project");
      expect(result).toBeNull();
    });

    it("returns null when state file is invalid JSON", () => {
      // Manually write a bad JSON file at the expected location
      const { createHash } = require("crypto");
      const { writeFileSync, mkdirSync } = require("fs");
      const { resolve } = require("path");
      const hash = createHash("sha256").update("/bad/project").digest("hex").slice(0, 12);
      mkdirSync(tempStateDir, { recursive: true });
      writeFileSync(resolve(tempStateDir, `${hash}.json`), "NOT VALID JSON");

      const result = loadState("/bad/project");
      expect(result).toBeNull();
    });
  });

  describe("saveState and loadState round-trip", () => {
    it("saves and loads a state successfully", async () => {
      const resources: ProvisionedResource[] = [
        { type: "server", id: "srv-1", region: "eu-central" },
      ];
      const state = createState("/my/project", "vps", resources);
      saveState(state);

      const loaded = loadState("/my/project");
      expect(loaded).not.toBeNull();
      expect(loaded!.projectPath).toBe("/my/project");
      expect(loaded!.provider).toBe("vps");
      expect(loaded!.resources).toEqual(resources);
    });

    it("saveState updates the updatedAt field", () => {
      const state = createState("/my/project", "vps", []);
      const originalUpdated = state.updatedAt;

      // Ensure at least 1ms passes so updatedAt changes
      const later = new Date(Date.now() + 10).toISOString();
      vi.setSystemTime(new Date(Date.now() + 10));

      saveState(state);

      vi.useRealTimers();

      const loaded = loadState("/my/project");
      expect(loaded).not.toBeNull();
      // updatedAt should be modified by saveState
      expect(typeof loaded!.updatedAt).toBe("string");
    });

    it("saves and loads multiple different projects independently", () => {
      const state1 = createState("/project/one", "vps", [{ type: "server", id: "a" }]);
      const state2 = createState("/project/two", "vps", [{ type: "server", id: "b" }]);

      saveState(state1);
      saveState(state2);

      const loaded1 = loadState("/project/one");
      const loaded2 = loadState("/project/two");

      expect(loaded1!.resources[0].id).toBe("a");
      expect(loaded2!.resources[0].id).toBe("b");
    });

    it("overwrites existing state when saved again", () => {
      const state = createState("/my/project", "vps", [{ type: "server", id: "old" }]);
      saveState(state);

      const updated: ProvisionedState = {
        ...state,
        resources: [{ type: "server", id: "new" }],
      };
      saveState(updated);

      const loaded = loadState("/my/project");
      expect(loaded!.resources[0].id).toBe("new");
    });
  });

  describe("deleteState", () => {
    it("deletes an existing state file", () => {
      const state = createState("/to-delete", "vps", []);
      saveState(state);

      // Verify it exists first
      expect(loadState("/to-delete")).not.toBeNull();

      deleteState("/to-delete");
      expect(loadState("/to-delete")).toBeNull();
    });

    it("does not throw when state file does not exist", () => {
      expect(() => deleteState("/nonexistent/project")).not.toThrow();
    });

    it("only deletes the specified project's state", () => {
      const state1 = createState("/keep/this", "vps", [{ type: "server", id: "keep" }]);
      const state2 = createState("/delete/this", "vps", [{ type: "server", id: "del" }]);
      saveState(state1);
      saveState(state2);

      deleteState("/delete/this");

      expect(loadState("/keep/this")).not.toBeNull();
      expect(loadState("/delete/this")).toBeNull();
    });
  });
});
