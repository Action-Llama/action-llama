/**
 * Database layer — re-exports for convenient imports.
 */

export * from "./schema.js";
export { createDb, createMemoryDb } from "./connection.js";
export type { AppDb } from "./connection.js";
export { runMigrations, applyMigrations, defaultMigrationsFolder } from "./migrate.js";
