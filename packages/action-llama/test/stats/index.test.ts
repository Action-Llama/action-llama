import { describe, it, expect } from "vitest";
import { StatsStore } from "../../src/stats/index.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("stats/index barrel export", () => {
  it("exports StatsStore class from the index", () => {
    expect(StatsStore).toBeDefined();
    expect(typeof StatsStore).toBe("function");
  });

  it("StatsStore exported from index is functional (can create instance)", () => {
    const dir = mkdtempSync(join(tmpdir(), "al-stats-index-"));
    try {
      const store = new StatsStore(join(dir, "stats.db"));
      expect(store).toBeInstanceOf(StatsStore);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
