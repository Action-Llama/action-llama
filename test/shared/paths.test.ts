import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { homedir } from "os";
import {
  AL_HOME,
  CREDENTIALS_DIR,
  projectDir,
  stateDir,
  logsDir,
  eventsDir,
  agentDir,
} from "../../src/shared/paths.js";

describe("paths", () => {
  it("AL_HOME is under homedir", () => {
    expect(AL_HOME).toBe(resolve(homedir(), ".al"));
  });

  it("CREDENTIALS_DIR is under homedir", () => {
    expect(CREDENTIALS_DIR).toBe(resolve(homedir(), ".al-credentials"));
  });

  it("projectDir resolves the path", () => {
    expect(projectDir("/tmp/my-project")).toBe(resolve("/tmp/my-project"));
  });

  it("stateDir appends .al/state", () => {
    expect(stateDir("/proj")).toBe(resolve("/proj", ".al", "state"));
  });

  it("logsDir appends .al/logs", () => {
    expect(logsDir("/proj")).toBe(resolve("/proj", ".al", "logs"));
  });

  it("eventsDir appends .al/events", () => {
    expect(eventsDir("/proj")).toBe(resolve("/proj", ".al", "events"));
  });

  it("agentDir appends agent type", () => {
    expect(agentDir("/proj", "dev")).toBe(resolve("/proj", "dev"));
  });
});
