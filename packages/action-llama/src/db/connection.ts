/**
 * Shared database connection factory for action-llama.
 *
 * Creates a Drizzle ORM instance backed by better-sqlite3.
 * All database access should go through the returned Drizzle instance.
 * The underlying better-sqlite3 Database is available via `db.$client`.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import * as schema from "./schema.js";

export type AppDb = ReturnType<typeof createDb>;

/**
 * Create a Drizzle database connection for the given file path.
 * Creates parent directories if needed. Sets WAL mode and performance pragmas.
 */
export function createDb(dbPath: string): ReturnType<typeof drizzle<typeof schema>> {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("cache_size = 1000");
  sqlite.pragma("temp_store = memory");
  return drizzle(sqlite, { schema });
}

/**
 * Create an in-memory Drizzle database for tests.
 */
export function createMemoryDb(): ReturnType<typeof drizzle<typeof schema>> {
  return createDb(":memory:");
}
