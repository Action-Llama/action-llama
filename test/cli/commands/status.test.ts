import { describe, it, expect, afterEach } from "vitest";
import { rmSync } from "fs";
import { makeTmpProject, captureLog } from "../../helpers.js";
import { execute } from "../../../src/cli/commands/status.js";

describe("status", () => {
  let tmpDir: string;
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("shows status for all agents", async () => {
    tmpDir = makeTmpProject();
    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).toContain("AL Status");
    expect(output).toContain("dev:");
    expect(output).toContain("reviewer:");
    expect(output).toContain("devops:");
  });

  it("shows schedule", async () => {
    tmpDir = makeTmpProject();
    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).toContain("Schedule:");
  });
});
