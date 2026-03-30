import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createDb, createMemoryDb } from "../../src/db/connection.js";

describe("createDb", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("creates parent directories for a file path", () => {
    const dir = mkdtempSync(join(tmpdir(), "al-db-conn-"));
    dirs.push(dir);
    const dbPath = join(dir, "nested", "test.db");
    const db = createDb(dbPath);
    expect(existsSync(join(dir, "nested"))).toBe(true);
    (db as any).$client.close();
  });

  it("returns a Drizzle db with $client", () => {
    const dir = mkdtempSync(join(tmpdir(), "al-db-conn-"));
    dirs.push(dir);
    const db = createDb(join(dir, "test.db"));
    expect(typeof (db as any).$client).toBe("object");
    (db as any).$client.close();
  });

  it("sets WAL mode pragma", () => {
    const dir = mkdtempSync(join(tmpdir(), "al-db-conn-"));
    dirs.push(dir);
    const db = createDb(join(dir, "test.db"));
    const client = (db as any).$client;
    const row = client.pragma("journal_mode") as Array<{ journal_mode: string }>;
    expect(row[0]?.journal_mode ?? row).toBe("wal");
    client.close();
  });
});

describe("createMemoryDb", () => {
  it("returns a Drizzle db instance", () => {
    const db = createMemoryDb();
    expect(typeof (db as any).$client).toBe("object");
    (db as any).$client.close();
  });
});
