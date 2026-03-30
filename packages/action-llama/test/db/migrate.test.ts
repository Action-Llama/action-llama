import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import Database from "better-sqlite3";
import { runMigrations, defaultMigrationsFolder, applyMigrations } from "../../src/db/migrate.js";
import { createDb } from "../../src/db/connection.js";

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

  it("migrates data from legacy stats.db into consolidated DB", () => {
    const dir = makeTempDir();
    const alDir = join(dir, ".al");
    const dbPath = join(alDir, "action-llama.db");

    mkdirSync(alDir, { recursive: true });
    const legacyStats = new Database(join(alDir, "stats.db"));
    // Use integer ids to match the new schema (INTEGER PRIMARY KEY AUTOINCREMENT)
    legacyStats.exec(`
      CREATE TABLE IF NOT EXISTS webhook_receipts (
        id INTEGER PRIMARY KEY,
        delivery_id TEXT,
        source TEXT,
        event_summary TEXT,
        timestamp INTEGER,
        headers TEXT,
        body TEXT,
        matched_agents TEXT,
        status TEXT,
        dead_letter_reason TEXT
      )
    `);
    legacyStats.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY,
        instance_id TEXT,
        agent_name TEXT,
        trigger_type TEXT,
        trigger_source TEXT,
        result TEXT,
        exit_code INTEGER,
        started_at INTEGER,
        duration_ms INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_write_tokens INTEGER,
        total_tokens INTEGER,
        cost_usd REAL,
        turn_count INTEGER,
        error_message TEXT,
        pre_hook_ms INTEGER,
        post_hook_ms INTEGER,
        webhook_receipt_id TEXT
      )
    `);
    legacyStats.exec(`
      CREATE TABLE IF NOT EXISTS call_edges (
        id INTEGER PRIMARY KEY,
        caller_agent TEXT,
        caller_instance TEXT,
        target_agent TEXT,
        target_instance TEXT,
        depth INTEGER,
        started_at INTEGER,
        duration_ms INTEGER,
        status TEXT
      )
    `);
    legacyStats
      .prepare("INSERT INTO runs (id, instance_id, agent_name, trigger_type, trigger_source, result, started_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(1, "inst-1", "my-agent", "schedule", "cron", "success", Date.now(), 1000);
    legacyStats
      .prepare("INSERT INTO call_edges (id, caller_agent, caller_instance, target_agent, depth, started_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(1, "agent-a", "inst-a", "agent-b", 0, Date.now(), "success");
    legacyStats.close();

    const db = runMigrations(dbPath);
    const client = (db as any).$client;
    const row = client.prepare("SELECT agent_name FROM runs WHERE id = ?").get(1) as any;
    expect(row?.agent_name).toBe("my-agent");
    const edge = client.prepare("SELECT caller_agent FROM call_edges WHERE id = ?").get(1) as any;
    expect(edge?.caller_agent).toBe("agent-a");
    client.close();
  });

  it("migrates data from legacy work-queue.db into consolidated DB", () => {
    const dir = makeTempDir();
    const alDir = join(dir, ".al");
    const dbPath = join(alDir, "action-llama.db");

    mkdirSync(alDir, { recursive: true });
    const legacyWq = new Database(join(alDir, "work-queue.db"));
    legacyWq.exec(`
      CREATE TABLE IF NOT EXISTS work_queue (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        payload TEXT NOT NULL,
        received_at INTEGER NOT NULL
      )
    `);
    legacyWq
      .prepare("INSERT INTO work_queue (id, agent, payload, received_at) VALUES (?, ?, ?, ?)")
      .run("wq-1", "my-agent", '{"type":"schedule"}', Date.now());
    legacyWq.close();

    const db = runMigrations(dbPath);
    const client = (db as any).$client;
    const row = client.prepare("SELECT agent FROM work_queue WHERE id = ?").get("wq-1") as any;
    expect(row?.agent).toBe("my-agent");
    client.close();
  });

  it("handles corrupted legacy state.db without crashing", () => {
    const dir = makeTempDir();
    const alDir = join(dir, ".al");
    const dbPath = join(alDir, "action-llama.db");

    mkdirSync(alDir, { recursive: true });
    // Create a corrupted state.db (wrong schema — no 'state' table)
    const corruptLegacy = new Database(join(alDir, "state.db"));
    corruptLegacy.exec("CREATE TABLE wrong_table (id INTEGER PRIMARY KEY)");
    corruptLegacy.close();

    // Should not throw even though legacy schema doesn't match
    expect(() => {
      const db = runMigrations(dbPath);
      (db as any).$client.close();
    }).not.toThrow();
  });

  it("migrates all three legacy databases together", () => {
    const dir = makeTempDir();
    const alDir = join(dir, ".al");
    const dbPath = join(alDir, "action-llama.db");

    mkdirSync(alDir, { recursive: true });

    // Create legacy state.db
    const legacyState = new Database(join(alDir, "state.db"));
    legacyState.exec(`CREATE TABLE state (ns TEXT, key TEXT, value TEXT, expires_at INTEGER, PRIMARY KEY (ns, key))`);
    legacyState.prepare("INSERT INTO state VALUES (?, ?, ?, ?)").run("ns1", "k1", '"v1"', null);
    legacyState.close();

    // Create legacy stats.db
    const legacyStats = new Database(join(alDir, "stats.db"));
    legacyStats.exec(`CREATE TABLE webhook_receipts (id INTEGER PRIMARY KEY, delivery_id TEXT, source TEXT, event_summary TEXT, timestamp INTEGER, headers TEXT, body TEXT, matched_agents TEXT, status TEXT, dead_letter_reason TEXT)`);
    legacyStats.exec(`CREATE TABLE runs (id INTEGER PRIMARY KEY, instance_id TEXT, agent_name TEXT, trigger_type TEXT, trigger_source TEXT, result TEXT, exit_code INTEGER, started_at INTEGER, duration_ms INTEGER, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, total_tokens INTEGER, cost_usd REAL, turn_count INTEGER, error_message TEXT, pre_hook_ms INTEGER, post_hook_ms INTEGER, webhook_receipt_id TEXT)`);
    legacyStats.exec(`CREATE TABLE call_edges (id INTEGER PRIMARY KEY, caller_agent TEXT, caller_instance TEXT, target_agent TEXT, target_instance TEXT, depth INTEGER, started_at INTEGER, duration_ms INTEGER, status TEXT)`);
    legacyStats.close();

    // Create legacy work-queue.db
    const legacyWq = new Database(join(alDir, "work-queue.db"));
    legacyWq.exec(`CREATE TABLE work_queue (id TEXT PRIMARY KEY, agent TEXT NOT NULL, payload TEXT NOT NULL, received_at INTEGER NOT NULL)`);
    legacyWq.close();

    const db = runMigrations(dbPath);
    const client = (db as any).$client;
    // Check state data was migrated
    const stateRow = client.prepare("SELECT value FROM state WHERE ns=? AND key=?").get("ns1", "k1") as any;
    expect(stateRow?.value).toBe('"v1"');
    // Check the migration marker was set
    const marker = client.prepare("SELECT value FROM kv_store WHERE namespace='__migration__' AND key='legacy_migrated'").get() as any;
    expect(marker?.value).toBe('"true"');
    client.close();
  });
});

describe("defaultMigrationsFolder", () => {
  it("returns a string path ending in 'drizzle'", () => {
    const folder = defaultMigrationsFolder();
    expect(typeof folder).toBe("string");
    expect(folder.endsWith("drizzle")).toBe(true);
  });
});

describe("applyMigrations", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("applies migrations to an existing AppDb without error", () => {
    const dir = mkdtempSync(join(tmpdir(), "al-apply-"));
    dirs.push(dir);
    const dbPath = join(dir, "test.db");
    const db = createDb(dbPath);
    // Should not throw
    expect(() => applyMigrations(db)).not.toThrow();
    (db as any).$client.close();
  });

  it("is idempotent — applying twice does not fail", () => {
    const dir = mkdtempSync(join(tmpdir(), "al-apply-"));
    dirs.push(dir);
    const dbPath = join(dir, "test.db");
    const db = createDb(dbPath);
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
    (db as any).$client.close();
  });
});
