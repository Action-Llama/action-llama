/**
 * Integration tests: shared/paths.ts utility functions — no Docker required.
 *
 * The paths module provides project-relative path utilities used throughout
 * the action-llama codebase. These tests verify the path construction logic
 * directly against the built dist.
 *
 * Test scenarios (no Docker required):
 *   1. logsDir() returns correct path under .al/logs
 *   2. eventsDir() returns correct path under .al/events
 *   3. agentDir() returns correct path under agents/
 *   4. dbPath() returns correct path for consolidated database
 *   5. statsDbPath() returns correct path (legacy path)
 *   6. stateDbPath() returns correct path (deprecated)
 *   7. workQueueDbPath() returns correct path (deprecated)
 *   8. projectDir() resolves the project path
 *
 * Covers:
 *   - shared/paths.ts: logsDir(), eventsDir(), agentDir() with various inputs
 *   - shared/paths.ts: dbPath() — consolidated DB path (introduced in 0103fab1)
 *   - shared/paths.ts: statsDbPath(), stateDbPath(), workQueueDbPath() legacy/deprecated
 *   - shared/paths.ts: projectDir() — path resolution
 */

import { describe, it, expect } from "vitest";
import { join } from "path";

const {
  logsDir,
  eventsDir,
  agentDir,
  dbPath,
  statsDbPath,
  stateDbPath,
  workQueueDbPath,
  projectDir,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/paths.js"
);

const PROJECT = "/tmp/test-project";

describe("integration: shared/paths.ts utility functions (no Docker required)", () => {
  it("logsDir() returns .al/logs under project", () => {
    expect(logsDir(PROJECT)).toBe(join(PROJECT, ".al", "logs"));
  });

  it("eventsDir() returns .al/events under project", () => {
    expect(eventsDir(PROJECT)).toBe(join(PROJECT, ".al", "events"));
  });

  it("agentDir() returns agents/<name> under project", () => {
    expect(agentDir(PROJECT, "my-agent")).toBe(join(PROJECT, "agents", "my-agent"));
  });

  it("agentDir() handles hyphenated agent names", () => {
    expect(agentDir(PROJECT, "my-cool-agent")).toBe(join(PROJECT, "agents", "my-cool-agent"));
  });

  it("dbPath() returns .al/action-llama.db (consolidated DB)", () => {
    expect(dbPath(PROJECT)).toBe(join(PROJECT, ".al", "action-llama.db"));
  });

  it("statsDbPath() returns .al/stats.db (legacy)", () => {
    expect(statsDbPath(PROJECT)).toBe(join(PROJECT, ".al", "stats.db"));
  });

  it("stateDbPath() returns .al/state.db (deprecated)", () => {
    expect(stateDbPath(PROJECT)).toBe(join(PROJECT, ".al", "state.db"));
  });

  it("workQueueDbPath() returns .al/work-queue.db (deprecated)", () => {
    expect(workQueueDbPath(PROJECT)).toBe(join(PROJECT, ".al", "work-queue.db"));
  });

  it("projectDir() resolves the given project path", () => {
    expect(projectDir(PROJECT)).toBe(PROJECT);
  });

  it("logsDir() with relative path resolves correctly", () => {
    const result = logsDir("my-project");
    expect(result).toContain(join("my-project", ".al", "logs"));
  });
});
