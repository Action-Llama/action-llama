import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { homedir } from "os";
import {
  AL_HOME,
  AL_HOME_DIR,
  CREDENTIALS_DIR,
  STATE_DIR,
  ENVIRONMENTS_DIR,
  projectDir,
  logsDir,
  eventsDir,
  agentDir,
  statsDbPath,
  dbPath,
  stateDbPath,
  workQueueDbPath,
} from "../../src/shared/paths.js";

describe("paths", () => {
  it("AL_HOME is under homedir", () => {
    expect(AL_HOME).toBe(resolve(homedir(), ".al"));
  });

  it("AL_HOME_DIR is under homedir", () => {
    expect(AL_HOME_DIR).toBe(resolve(homedir(), ".action-llama"));
  });

  it("CREDENTIALS_DIR is under AL_HOME_DIR", () => {
    expect(CREDENTIALS_DIR).toBe(resolve(homedir(), ".action-llama", "credentials"));
  });

  it("STATE_DIR is under AL_HOME_DIR", () => {
    expect(STATE_DIR).toBe(resolve(homedir(), ".action-llama", "state"));
  });

  it("projectDir resolves the path", () => {
    expect(projectDir("/tmp/my-project")).toBe(resolve("/tmp/my-project"));
  });

  it("logsDir appends .al/logs", () => {
    expect(logsDir("/proj")).toBe(resolve("/proj", ".al", "logs"));
  });

  it("eventsDir appends .al/events", () => {
    expect(eventsDir("/proj")).toBe(resolve("/proj", ".al", "events"));
  });

  it("agentDir appends agent type", () => {
    expect(agentDir("/proj", "dev")).toBe(resolve("/proj", "agents", "dev"));
  });

  it("ENVIRONMENTS_DIR is under AL_HOME_DIR", () => {
    expect(ENVIRONMENTS_DIR).toBe(resolve(homedir(), ".action-llama", "environments"));
  });

  it("statsDbPath appends .al/stats.db", () => {
    expect(statsDbPath("/proj")).toBe(resolve("/proj", ".al", "stats.db"));
  });

  it("dbPath appends .al/action-llama.db", () => {
    expect(dbPath("/proj")).toBe(resolve("/proj", ".al", "action-llama.db"));
  });

  it("stateDbPath appends .al/state.db (deprecated)", () => {
    expect(stateDbPath("/proj")).toBe(resolve("/proj", ".al", "state.db"));
  });

  it("workQueueDbPath appends .al/work-queue.db (deprecated)", () => {
    expect(workQueueDbPath("/proj")).toBe(resolve("/proj", ".al", "work-queue.db"));
  });
});
