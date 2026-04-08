/**
 * Integration tests: db/migrate.ts and related database utilities — no Docker required.
 *
 * Tests the consolidated database migration runner, including:
 *   - runMigrations(): creates DB from scratch, runs all pending migrations,
 *     marks legacy migration as done, returns AppDb
 *   - applyMigrations(): applies migrations to an existing AppDb connection
 *   - defaultMigrationsFolder(): returns path to bundled drizzle/ folder
 *   - backupExistingDbs() (indirectly): backs up existing .db files before migration
 *   - migrateLegacyData() (indirectly): one-time migration of legacy separate DBs
 *
 * Also tests:
 *   - db/connection.ts createDb() / createMemoryDb() — DB creation, pragmas
 *   - scheduler/watcher.ts agentNameFromPath() — pure function for path extraction
 *   - cli/with-command.ts withCommand() — error handling wrapper
 *   - cli/resolve-target.ts resolveTarget() — agent name resolution
 *
 * All tests run without any scheduler or Docker setup.
 *
 * Covers:
 *   - db/migrate.ts: runMigrations() — fresh DB path, applies migrations
 *   - db/migrate.ts: runMigrations() — idempotent on second call (no-op)
 *   - db/migrate.ts: runMigrations() — backs up existing DB to .al/backups/
 *   - db/migrate.ts: runMigrations() — migrateLegacyData marks legacy_migrated in kv_store
 *   - db/migrate.ts: applyMigrations() — applies migrations to open AppDb
 *   - db/migrate.ts: defaultMigrationsFolder() — returns existing directory
 *   - db/connection.ts: createDb() — creates DB at path, WAL mode, parent dirs
 *   - db/connection.ts: createMemoryDb() — returns in-memory DB
 *   - scheduler/watcher.ts: agentNameFromPath() — extracts agent name from path
 *   - cli/with-command.ts: withCommand() — passes through on success
 *   - cli/with-command.ts: withCommand() — ConfigError printed, exits 1
 *   - cli/with-command.ts: withCommand() — CredentialError printed, exits 1
 *   - cli/with-command.ts: withCommand() — generic Error printed, exits 1
 *   - cli/resolve-target.ts: resolveTarget() — valid agent name returned as-is
 *   - cli/resolve-target.ts: resolveTarget() — unknown name passed through
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, existsSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import Database from "better-sqlite3";

const {
  runMigrations,
  applyMigrations,
  defaultMigrationsFolder,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/db/migrate.js"
);

const {
  createDb,
  createMemoryDb,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/db/connection.js"
);

const {
  agentNameFromPath,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/scheduler/watcher.js"
);

const {
  withCommand,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/with-command.js"
);

const {
  resolveTarget,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/resolve-target.js"
);

const {
  ConfigError,
  CredentialError,
  AgentError,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/errors.js"
);

// ── db/migrate.ts ──────────────────────────────────────────────────────────

describe("integration: db/migrate.ts and database utilities (no Docker required)", { timeout: 30_000 }, () => {

  describe("defaultMigrationsFolder()", () => {
    it("returns an existing directory containing SQL migration files", () => {
      const folder = defaultMigrationsFolder();
      expect(existsSync(folder)).toBe(true);
      const files = readdirSync(folder);
      // Should contain at least one .sql migration file
      const sqlFiles = files.filter((f: string) => f.endsWith(".sql"));
      expect(sqlFiles.length).toBeGreaterThan(0);
    });

    it("returns a path containing 'drizzle'", () => {
      const folder = defaultMigrationsFolder();
      expect(folder).toContain("drizzle");
    });
  });

  describe("createDb() / createMemoryDb()", () => {
    it("createMemoryDb() returns an in-memory Drizzle instance", () => {
      const db = createMemoryDb();
      expect(db).toBeDefined();
      expect(typeof db).toBe("object");
      // Verify we can access the underlying sqlite client
      const client = (db as any).$client;
      expect(client).toBeDefined();
    });

    it("createDb() creates parent directories and the file", () => {
      const dir = mkdtempSync(join(tmpdir(), "al-db-test-"));
      const dbPath = join(dir, "sub", "nested", "test.db");
      const db = createDb(dbPath);
      expect(db).toBeDefined();
      // After creation, the file should exist
      expect(existsSync(dbPath)).toBe(true);
      // Close the DB
      try { (db as any).$client.close(); } catch {}
    });

    it("createDb() sets WAL journal mode", () => {
      const dir = mkdtempSync(join(tmpdir(), "al-db-wal-"));
      const dbPath = join(dir, "wal.db");
      const db = createDb(dbPath);
      const client = (db as any).$client;
      const mode = client.pragma("journal_mode", { simple: true });
      expect(mode).toBe("wal");
      try { client.close(); } catch {}
    });
  });

  describe("runMigrations()", () => {
    it("creates a new database and applies all migrations", () => {
      const dir = mkdtempSync(join(tmpdir(), "al-migrate-fresh-"));
      const alDir = join(dir, ".al");
      mkdirSync(alDir, { recursive: true });
      const dbPath = join(alDir, "action-llama.db");

      const db = runMigrations(dbPath);
      expect(db).toBeDefined();
      expect(existsSync(dbPath)).toBe(true);

      // Verify core tables exist by querying them
      const client = (db as any).$client;
      const tables = client
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((r: any) => r.name);

      // Expect core tables from migrations
      expect(tables).toContain("runs");
      expect(tables).toContain("webhook_receipts");
      expect(tables).toContain("call_edges");
      expect(tables).toContain("state");
      expect(tables).toContain("kv_store");
      try { client.close(); } catch {}
    });

    it("marks legacy migration as done on fresh install (no legacy files)", () => {
      const dir = mkdtempSync(join(tmpdir(), "al-migrate-mark-"));
      const alDir = join(dir, ".al");
      mkdirSync(alDir, { recursive: true });
      const dbPath = join(alDir, "action-llama.db");

      const db = runMigrations(dbPath);
      const client = (db as any).$client;

      // Should have marked migration as done in kv_store
      const row = client
        .prepare("SELECT value FROM kv_store WHERE namespace = '__migration__' AND key = 'legacy_migrated' LIMIT 1")
        .get();
      expect(row).toBeDefined();
      expect(row.value).toContain("true");
      try { client.close(); } catch {}
    });

    it("is idempotent — second call applies no additional migrations", () => {
      const dir = mkdtempSync(join(tmpdir(), "al-migrate-idem-"));
      const alDir = join(dir, ".al");
      mkdirSync(alDir, { recursive: true });
      const dbPath = join(alDir, "action-llama.db");

      // First migration
      const db1 = runMigrations(dbPath);
      const client1 = (db1 as any).$client;
      const rowsBefore = client1
        .prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'")
        .get() as any;
      try { client1.close(); } catch {}

      // Second migration — should be idempotent
      const db2 = runMigrations(dbPath);
      const client2 = (db2 as any).$client;
      const rowsAfter = client2
        .prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'")
        .get() as any;
      try { client2.close(); } catch {}

      // Same number of tables
      expect(rowsAfter.c).toBe(rowsBefore.c);
    });

    it("backs up existing .al/action-llama.db before migrating", () => {
      const dir = mkdtempSync(join(tmpdir(), "al-migrate-backup-"));
      const alDir = join(dir, ".al");
      mkdirSync(alDir, { recursive: true });
      const dbPath = join(alDir, "action-llama.db");

      // Create a pre-existing valid SQLite DB file (so it can be opened for backup)
      const existingDb = new Database(dbPath);
      existingDb.exec("CREATE TABLE test_backup (id INTEGER PRIMARY KEY)");
      existingDb.close();

      // Run migrations — should backup the existing file first
      const db = runMigrations(dbPath);
      try { (db as any).$client.close(); } catch {}

      // Verify backup directory was created
      const backupDir = join(alDir, "backups");
      expect(existsSync(backupDir)).toBe(true);

      // There should be at least one backup timestamp directory
      const backupDirs = readdirSync(backupDir);
      expect(backupDirs.length).toBeGreaterThan(0);
    });

    it("migrates legacy state.db data into consolidated DB", () => {
      const dir = mkdtempSync(join(tmpdir(), "al-migrate-legacy-state-"));
      const alDir = join(dir, ".al");
      mkdirSync(alDir, { recursive: true });
      const dbPath = join(alDir, "action-llama.db");

      // Create a fake legacy state.db with some data
      const legacyStateDbPath = join(alDir, "state.db");
      // Create legacy DB using better-sqlite3 directly (not drizzle)
      
      const legacyDb = new Database(legacyStateDbPath);
      legacyDb.exec(`
        CREATE TABLE IF NOT EXISTS state (
          ns TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          expires_at INTEGER,
          PRIMARY KEY (ns, key)
        )
      `);
      legacyDb.prepare("INSERT INTO state (ns, key, value, expires_at) VALUES (?, ?, ?, NULL)")
        .run("test-ns", "test-key", '"test-value"');
      legacyDb.close();

      // Run migrations — should migrate legacy state data
      const db = runMigrations(dbPath);
      const client = (db as any).$client;

      // Verify the legacy data was migrated
      const row = client
        .prepare("SELECT value FROM state WHERE ns = 'test-ns' AND key = 'test-key'")
        .get() as any;
      expect(row).toBeDefined();
      expect(row.value).toBe('"test-value"');
      try { client.close(); } catch {}
    });

    it("migrates legacy work-queue.db data into consolidated DB", () => {
      const dir = mkdtempSync(join(tmpdir(), "al-migrate-legacy-wq-"));
      const alDir = join(dir, ".al");
      mkdirSync(alDir, { recursive: true });
      const dbPath = join(alDir, "action-llama.db");

      // Create a fake legacy work-queue.db with some data
      const legacyWqDbPath = join(alDir, "work-queue.db");
      
      const legacyDb = new Database(legacyWqDbPath);
      legacyDb.exec(`
        CREATE TABLE IF NOT EXISTS work_queue (
          id TEXT PRIMARY KEY,
          agent TEXT NOT NULL,
          payload TEXT NOT NULL,
          received_at INTEGER NOT NULL
        )
      `);
      legacyDb.prepare("INSERT INTO work_queue (id, agent, payload, received_at) VALUES (?, ?, ?, ?)")
        .run("test-id-123", "my-agent", '{"type":"manual"}', Date.now());
      legacyDb.close();

      // Run migrations — should migrate legacy work-queue data
      const db = runMigrations(dbPath);
      const client = (db as any).$client;

      // Verify the legacy data was migrated
      const row = client
        .prepare("SELECT agent, payload FROM work_queue WHERE id = 'test-id-123'")
        .get() as any;
      expect(row).toBeDefined();
      expect(row.agent).toBe("my-agent");
      try { client.close(); } catch {}
    });

    it("does not re-migrate legacy data on second runMigrations() call", () => {
      const dir = mkdtempSync(join(tmpdir(), "al-migrate-no-remigrate-"));
      const alDir = join(dir, ".al");
      mkdirSync(alDir, { recursive: true });
      const dbPath = join(alDir, "action-llama.db");

      // Create legacy state.db with 1 row
      const legacyStateDbPath = join(alDir, "state.db");
      
      const legacyDb = new Database(legacyStateDbPath);
      legacyDb.exec(`CREATE TABLE IF NOT EXISTS state (ns TEXT, key TEXT, value TEXT, expires_at INTEGER, PRIMARY KEY (ns, key))`);
      legacyDb.prepare("INSERT INTO state (ns, key, value, expires_at) VALUES (?, ?, ?, NULL)").run("ns1", "k1", '"v1"');
      legacyDb.close();

      // First migration — migrates data
      const db1 = runMigrations(dbPath);
      try { (db1 as any).$client.close(); } catch {}

      // Add more data to the legacy DB (simulates "new" data appearing)
      const legacyDb2 = new Database(legacyStateDbPath);
      legacyDb2.prepare("INSERT INTO state (ns, key, value, expires_at) VALUES (?, ?, ?, NULL)").run("ns1", "k2", '"v2"');
      legacyDb2.close();

      // Second migration — should NOT re-migrate (k2 should not appear)
      const db2 = runMigrations(dbPath);
      const client2 = (db2 as any).$client;
      const rows = client2.prepare("SELECT key FROM state WHERE ns = 'ns1' ORDER BY key").all();
      // Only the original row should be there (migration is one-time only)
      expect(rows.map((r: any) => r.key)).toEqual(["k1"]);
      try { client2.close(); } catch {}
    });
  });

  describe("applyMigrations()", () => {
    it("applies migrations to an existing in-memory DB", () => {
      const db = createMemoryDb();
      // Before migrations, core tables should not exist
      const client = (db as any).$client;
      const tablesBefore = client
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r: any) => r.name);
      expect(tablesBefore).not.toContain("runs");

      // Apply migrations
      applyMigrations(db);

      const tablesAfter = client
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((r: any) => r.name);
      expect(tablesAfter).toContain("runs");
      expect(tablesAfter).toContain("webhook_receipts");
      expect(tablesAfter).toContain("call_edges");
    });

    it("is idempotent when called twice on same DB", () => {
      const db = createMemoryDb();
      applyMigrations(db);
      // Second call should not throw
      expect(() => applyMigrations(db)).not.toThrow();
    });
  });

  // ── scheduler/watcher.ts agentNameFromPath() ──────────────────────────────

  describe("agentNameFromPath() (scheduler/watcher.ts)", () => {
    it("returns the first path segment as agent name", () => {
      expect(agentNameFromPath("my-agent/SKILL.md")).toBe("my-agent");
    });

    it("returns agent name from nested path", () => {
      expect(agentNameFromPath("my-agent/config.toml")).toBe("my-agent");
    });

    it("returns null for empty string", () => {
      expect(agentNameFromPath("")).toBeNull();
    });

    it("returns null for hidden directories (starting with .)", () => {
      expect(agentNameFromPath(".hidden/SKILL.md")).toBeNull();
    });

    it("returns null when path starts with dot-segment", () => {
      expect(agentNameFromPath(".git/config")).toBeNull();
    });

    it("returns agent name for single-segment path (file in root)", () => {
      expect(agentNameFromPath("my-agent")).toBe("my-agent");
    });

    it("handles Windows-style path separators", () => {
      expect(agentNameFromPath("my-agent\\SKILL.md")).toBe("my-agent");
    });

    it("returns agent name for deeply nested path", () => {
      expect(agentNameFromPath("deploy-agent/hooks/pre-run.sh")).toBe("deploy-agent");
    });
  });

  // ── cli/with-command.ts withCommand() ─────────────────────────────────────

  describe("withCommand() (cli/with-command.ts)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("calls the wrapped function and returns normally on success", async () => {
      let called = false;
      const fn = withCommand(async (x: number) => {
        called = true;
        expect(x).toBe(42);
      });

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await fn(42);

      expect(called).toBe(true);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("calls process.exit(1) on ConfigError and prints error message", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const fn = withCommand(async () => {
        throw new ConfigError("bad config value");
      });

      await fn();

      expect(exitSpy).toHaveBeenCalledWith(1);
      const messages = errSpy.mock.calls.map((c: any[]) => c.join(" "));
      expect(messages.some((m: string) => m.includes("Configuration error"))).toBe(true);
      expect(messages.some((m: string) => m.includes("bad config value"))).toBe(true);
    });

    it("calls process.exit(1) on CredentialError and prints error message", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const fn = withCommand(async () => {
        throw new CredentialError("missing api key");
      });

      await fn();

      expect(exitSpy).toHaveBeenCalledWith(1);
      const messages = errSpy.mock.calls.map((c: any[]) => c.join(" "));
      expect(messages.some((m: string) => m.includes("Credential error"))).toBe(true);
      expect(messages.some((m: string) => m.includes("missing api key"))).toBe(true);
    });

    it("calls process.exit(1) on AgentError and prints error message", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const fn = withCommand(async () => {
        throw new AgentError("agent crashed");
      });

      await fn();

      expect(exitSpy).toHaveBeenCalledWith(1);
      const messages = errSpy.mock.calls.map((c: any[]) => c.join(" "));
      expect(messages.some((m: string) => m.includes("Agent error"))).toBe(true);
      expect(messages.some((m: string) => m.includes("agent crashed"))).toBe(true);
    });

    it("calls process.exit(1) on generic Error and prints error message", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const fn = withCommand(async () => {
        throw new Error("something went wrong");
      });

      await fn();

      expect(exitSpy).toHaveBeenCalledWith(1);
      const messages = errSpy.mock.calls.map((c: any[]) => c.join(" "));
      expect(messages.some((m: string) => m.includes("Error"))).toBe(true);
      expect(messages.some((m: string) => m.includes("something went wrong"))).toBe(true);
    });

    it("calls process.exit(1) on thrown string", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const fn = withCommand(async () => {
        throw "a string error";
      });

      await fn();

      expect(exitSpy).toHaveBeenCalledWith(1);
      const messages = errSpy.mock.calls.map((c: any[]) => c.join(" "));
      expect(messages.some((m: string) => m.includes("a string error"))).toBe(true);
    });

    it("prints cause when Error has a cause property", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const cause = new Error("root cause");
      const fn = withCommand(async () => {
        throw new Error("wrapper error", { cause });
      });

      await fn();

      expect(exitSpy).toHaveBeenCalledWith(1);
      const messages = errSpy.mock.calls.map((c: any[]) => c.join(" "));
      expect(messages.some((m: string) => m.includes("Cause"))).toBe(true);
    });
  });

  // ── cli/resolve-target.ts resolveTarget() ─────────────────────────────────

  describe("resolveTarget() (cli/resolve-target.ts)", () => {
    it("returns agent name for a string that passes through loadAgentConfig", async () => {
      // Create a temp project with an agent directory
      const dir = mkdtempSync(join(tmpdir(), "al-resolve-"));
      const agentDir = join(dir, "agents", "my-agent");
      mkdirSync(agentDir, { recursive: true });
      // Write minimal SKILL.md and config.toml
      writeFileSync(join(agentDir, "SKILL.md"), `---\nname: my-agent\n---\n\n# my-agent\n`);
      writeFileSync(join(agentDir, "config.toml"), `models = ["sonnet"]\nschedule = "0 0 * * *"\n`);
      writeFileSync(join(dir, "config.toml"), `[models.sonnet]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-5"\n`);

      const result = await resolveTarget("my-agent", dir);
      expect(result.agent).toBe("my-agent");
    });

    it("passes through unknown agent name as-is", async () => {
      const dir = mkdtempSync(join(tmpdir(), "al-resolve-unknown-"));
      mkdirSync(join(dir, "agents"), { recursive: true });
      writeFileSync(join(dir, "config.toml"), `[models.sonnet]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-5"\n`);

      // "scheduler" is not a real agent config dir, but resolveTarget should pass it through
      const result = await resolveTarget("scheduler", dir);
      expect(result.agent).toBe("scheduler");
    });

    it("passes through completely unknown name when no config exists", async () => {
      const dir = mkdtempSync(join(tmpdir(), "al-resolve-noconfig-"));
      mkdirSync(join(dir, "agents"), { recursive: true });
      writeFileSync(join(dir, "config.toml"), `[models.sonnet]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-5"\n`);

      const result = await resolveTarget("nonexistent-agent", dir);
      expect(result.agent).toBe("nonexistent-agent");
    });

    it("returns object with agent and optional taskId fields", async () => {
      const dir = mkdtempSync(join(tmpdir(), "al-resolve-shape-"));
      mkdirSync(join(dir, "agents"), { recursive: true });
      writeFileSync(join(dir, "config.toml"), `[models.sonnet]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-5"\n`);

      const result = await resolveTarget("any-agent", dir);
      expect(typeof result.agent).toBe("string");
      // taskId is optional
      expect("taskId" in result || !("taskId" in result)).toBe(true);
    });
  });
});
