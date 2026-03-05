import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { homedir } from "os";
import {
  AL_HOME,
  CREDENTIALS_DIR,
  projectDir,
  logsDir,
  eventsDir,
  agentDir,
} from "../../src/shared/paths.js";

describe("paths", () => {
  it("AL_HOME is under homedir", () => {
    expect(AL_HOME).toBe(resolve(homedir(), ".al"));
  });

  it("CREDENTIALS_DIR is under homedir", () => {
    expect(CREDENTIALS_DIR).toBe(resolve(homedir(), ".action-llama-credentials"));
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
    expect(agentDir("/proj", "dev")).toBe(resolve("/proj", "dev"));
  });
});
