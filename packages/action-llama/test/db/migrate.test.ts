import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrate.js";

describe("runMigrations", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "al-migrate-"));
    dirs.push(dir);
    return dir;
  }

  it("creates the consolidated DB on fresh start (no legacy files)", () => {
    const dir = makeTempDir();
    const alDir = join(dir, ".al");
    const dbPath = join(alDir, "action-llama.db");
    const db = runMigrations(dbPath);
    expect(existsSync(dbPath)).toBe(true);
    (db as any).$client.close();
  });

  it("creates all expected tables", () => {
    const dir = makeTempDir();
    const alDir = join(dir, ".al");
    const dbPath = join(alDir, "action-llama.db");
    const db = runMigrations(dbPath);
    const client = (db as any).$client;
    const tables = client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'")
      .all()
      .map((r: any) => r.name)
      .sort();
    expect(tables).toContain("state");
    expect(tables).toContain("runs");
    expect(tables).toContain("webhook_receipts");
    expect(tables).toContain("call_edges");
    expect(tables).toContain("work_queue");
    expect(tables).toContain("queue");
    expect(tables).toContain("kv_store");
    expect(tables).toContain("events");
    expect(tables).toContain("snapshots");
    client.close();
  });

  it("creates a backup of existing .db files", () => {
    const dir = makeTempDir();
    const alDir = join(dir, ".al");
    const dbPath = join(alDir, "action-llama.db");

    // Create a dummy legacy state.db
    const { mkdirSync } = require("fs");
    mkdirSync(alDir, { recursive: true });
    const legacyDb = new Database(join(alDir, "state.db"));
    legacyDb.exec("CREATE TABLE foo (id INTEGER PRIMARY KEY)");
    legacyDb.close();

    const db = runMigrations(dbPath);
    (db as any).$client.close();

    // Verify backup directory was created
    const backupsDir = join(alDir, "backups");
    expect(existsSync(backupsDir)).toBe(true);
    const backupDirs = require("fs").readdirSync(backupsDir);
    expect(backupDirs.length).toBeGreaterThan(0);
  });

  it("migrates data from legacy state.db into consolidated DB", () => {
    const dir = makeTempDir();
    const alDir = join(dir, ".al");
    const dbPath = join(alDir, "action-llama.db");

    // Create a legacy state.db with test data
    const { mkdirSync } = require("fs");
    mkdirSync(alDir, { recursive: true });
    const legacyState = new Database(join(alDir, "state.db"));
    legacyState.exec(`
      CREATE TABLE IF NOT EXISTS state (
        ns TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        expires_at INTEGER,
        PRIMARY KEY (ns, key)
      )
    `);
    legacyState.prepare("INSERT INTO state (ns, key, value) VALUES (?, ?, ?)").run("test-ns", "test-key", '"hello"');
    legacyState.close();

    const db = runMigrations(dbPath);
    const client = (db as any).$client;
    const row = client.prepare("SELECT value FROM state WHERE ns = ? AND key = ?").get("test-ns", "test-key") as any;
    expect(row?.value).toBe('"hello"');
    client.close();
  });

  it("is idempotent — running twice doesn't fail", () => {
    const dir = makeTempDir();
    const alDir = join(dir, ".al");
    const dbPath = join(alDir, "action-llama.db");
    const db1 = runMigrations(dbPath);
    (db1 as any).$client.close();
    const db2 = runMigrations(dbPath);
    expect(existsSync(dbPath)).toBe(true);
    (db2 as any).$client.close();
  });
});
