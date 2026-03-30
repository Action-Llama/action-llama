import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createStateStore } from "../../src/shared/state-store.js";

describe("createStateStore", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("creates a working sqlite StateStore for 'sqlite' type", async () => {
    const dir = mkdtempSync(join(tmpdir(), "al-state-store-"));
    dirs.push(dir);

    const store = await createStateStore({ type: "sqlite", path: join(dir, "state.db") });

    // Verify it is functional
    await store.set("test-ns", "key1", { value: 42 });
    const result = await store.get<{ value: number }>("test-ns", "key1");
    expect(result).toEqual({ value: 42 });

    await store.close();
  });

  it("returns null for missing keys", async () => {
    const dir = mkdtempSync(join(tmpdir(), "al-state-store-"));
    dirs.push(dir);

    const store = await createStateStore({ type: "sqlite", path: join(dir, "state.db") });
    const result = await store.get("ns", "nonexistent");
    expect(result).toBeNull();

    await store.close();
  });
});
