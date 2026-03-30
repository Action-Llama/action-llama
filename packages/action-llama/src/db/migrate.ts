/**
 * Auto-migration runner for the consolidated action-llama database.
 *
 * On startup:
 * 1. Backs up any existing .db files to .al/backups/<timestamp>/
 * 2. Runs pending Drizzle migrations against the consolidated DB
 * 3. If legacy separate .db files exist, migrates their data into the consolidated DB (one-time)
 */

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createDb } from "./connection.js";
import type { AppDb } from "./connection.js";

/**
 * Get the default migrations folder path relative to this module.
 */
export function defaultMigrationsFolder(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../drizzle");
}

/**
 * Run Drizzle migrations on an existing AppDb instance.
 * Useful for standalone stores that create their own connections.
 */
export function applyMigrations(db: AppDb, migrationsFolder?: string): void {
  const folder = migrationsFolder ?? defaultMigrationsFolder();
  migrate(db, { migrationsFolder: folder });
}

/**
 * Run pending migrations and optionally migrate legacy data.
 *
 * @param dbPath - Path to the consolidated .al/action-llama.db file
 * @param migrationsFolder - Path to the drizzle migrations folder (defaults to bundled drizzle/)
 * @returns The opened Drizzle database instance (caller is responsible for closing)
 */
export function runMigrations(dbPath: string, migrationsFolder?: string): AppDb {
  const projectAlDir = dirname(dbPath);

  // Back up existing database files before migrating
  backupExistingDbs(projectAlDir);

  // Open/create the consolidated DB
  const db = createDb(dbPath);

  // Run Drizzle migrations (idempotent — only applies pending ones)
  const folder = migrationsFolder ?? defaultMigrationsFolder();
  migrate(db, { migrationsFolder: folder });

  // Migrate legacy data if this is the first time we're consolidating
  migrateLegacyData(db, projectAlDir, dbPath);

  return db;
}

/**
 * Copy all existing .db files into .al/backups/<timestamp>/ before migrating.
 */
function backupExistingDbs(alDir: string): void {
  const legacyFiles = ["state.db", "stats.db", "work-queue.db", "action-llama.db"];
  const toBackup = legacyFiles.filter((f) => existsSync(join(alDir, f)));
  if (toBackup.length === 0) return;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(alDir, "backups", ts);
  mkdirSync(backupDir, { recursive: true });

  for (const f of toBackup) {
    const src = join(alDir, f);
    const dst = join(backupDir, f);
    copyFileSync(src, dst);
  }
}

/**
 * One-time migration of legacy separate databases into the consolidated DB.
 *
 * Uses the presence of a special marker in kv_store to know if migration
 * has already been performed.
 */
function migrateLegacyData(db: AppDb, alDir: string, consolidatedDbPath: string): void {
  // Check if we've already migrated (using the raw sqlite client for a quick check)
  const client = (db as any).$client;

  const alreadyMigrated = client
    .prepare("SELECT value FROM kv_store WHERE namespace = '__migration__' AND key = 'legacy_migrated' LIMIT 1")
    .get();

  if (alreadyMigrated) return;

  const legacyStateDb = join(alDir, "state.db");
  const legacyStatsDb = join(alDir, "stats.db");
  const legacyWorkQueueDb = join(alDir, "work-queue.db");

  const hasLegacy =
    existsSync(legacyStateDb) ||
    existsSync(legacyStatsDb) ||
    existsSync(legacyWorkQueueDb);

  if (!hasLegacy) {
    // No legacy files — mark as migrated and return
    markMigrated(client);
    return;
  }

  // Perform migration inside a transaction
  const doMigrate = client.transaction(() => {
    // 1. Migrate state.db
    if (existsSync(legacyStateDb)) {
      migrateLegacyState(client, legacyStateDb);
    }

    // 2. Migrate stats.db
    if (existsSync(legacyStatsDb)) {
      migrateLegacyStats(client, legacyStatsDb);
    }

    // 3. Migrate work-queue.db
    if (existsSync(legacyWorkQueueDb)) {
      migrateLegacyWorkQueue(client, legacyWorkQueueDb);
    }

    markMigrated(client);
  });

  doMigrate();
}

function markMigrated(client: any): void {
  const now = Date.now();
  client
    .prepare(
      "INSERT OR REPLACE INTO kv_store (namespace, key, value, created_at, updated_at) VALUES ('__migration__', 'legacy_migrated', '\"true\"', ?, ?)"
    )
    .run(now, now);
}

function migrateLegacyState(client: any, legacyPath: string): void {
  try {
    client.exec(`ATTACH DATABASE '${legacyPath.replace(/'/g, "''")}' AS legacy_state`);
    client.exec(`
      INSERT OR IGNORE INTO state (ns, key, value, expires_at)
      SELECT ns, key, value, expires_at FROM legacy_state.state
    `);
    client.exec("DETACH DATABASE legacy_state");
  } catch {
    // If the legacy db doesn't have the expected schema, skip
    try { client.exec("DETACH DATABASE legacy_state"); } catch {}
  }
}

function migrateLegacyStats(client: any, legacyPath: string): void {
  try {
    client.exec(`ATTACH DATABASE '${legacyPath.replace(/'/g, "''")}' AS legacy_stats`);

    // Migrate webhook_receipts first (runs has a FK-like reference via webhook_receipt_id)
    client.exec(`
      INSERT OR IGNORE INTO webhook_receipts (id, delivery_id, source, event_summary, timestamp, headers, body, matched_agents, status, dead_letter_reason)
      SELECT id, delivery_id, source, event_summary, timestamp, headers, body, matched_agents, status, dead_letter_reason
      FROM legacy_stats.webhook_receipts
    `);

    // Migrate runs
    client.exec(`
      INSERT OR IGNORE INTO runs (id, instance_id, agent_name, trigger_type, trigger_source, result, exit_code, started_at, duration_ms, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost_usd, turn_count, error_message, pre_hook_ms, post_hook_ms, webhook_receipt_id)
      SELECT id, instance_id, agent_name, trigger_type, trigger_source, result, exit_code, started_at, duration_ms,
             COALESCE(input_tokens, 0), COALESCE(output_tokens, 0), COALESCE(cache_read_tokens, 0), COALESCE(cache_write_tokens, 0),
             COALESCE(total_tokens, 0), COALESCE(cost_usd, 0), COALESCE(turn_count, 0),
             error_message, pre_hook_ms, post_hook_ms, webhook_receipt_id
      FROM legacy_stats.runs
    `);

    // Migrate call_edges
    client.exec(`
      INSERT OR IGNORE INTO call_edges (id, caller_agent, caller_instance, target_agent, target_instance, depth, started_at, duration_ms, status)
      SELECT id, caller_agent, caller_instance, target_agent, target_instance, depth, started_at, duration_ms, status
      FROM legacy_stats.call_edges
    `);

    client.exec("DETACH DATABASE legacy_stats");
  } catch {
    try { client.exec("DETACH DATABASE legacy_stats"); } catch {}
  }
}

function migrateLegacyWorkQueue(client: any, legacyPath: string): void {
  try {
    client.exec(`ATTACH DATABASE '${legacyPath.replace(/'/g, "''")}' AS legacy_wq`);
    client.exec(`
      INSERT OR IGNORE INTO work_queue (id, agent, payload, received_at)
      SELECT id, agent, payload, received_at FROM legacy_wq.work_queue
    `);
    client.exec("DETACH DATABASE legacy_wq");
  } catch {
    try { client.exec("DETACH DATABASE legacy_wq"); } catch {}
  }
}
