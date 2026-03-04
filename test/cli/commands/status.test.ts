import { describe, it, expect, afterEach } from "vitest";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { makeTmpProject, captureLog } from "../../helpers.js";
import { execute } from "../../../src/cli/commands/status.js";

function writeState(projectPath: string, agent: string, file: string, data: any): void {
  const dir = resolve(projectPath, ".al", "state", agent);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, file), JSON.stringify(data, null, 2) + "\n");
}

describe("status", () => {
  let tmpDir: string;
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("shows status with empty state", async () => {
    tmpDir = makeTmpProject();
    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).toContain("AL Status");
    expect(output).toContain("dev:");
    expect(output).not.toContain("type:");
    expect(output).toContain("reviewer:");
    expect(output).toContain("devops:");
  });

  it("shows in-progress issues", async () => {
    tmpDir = makeTmpProject();
    writeState(tmpDir, "dev", "active-issues.json", {
      issues: {
        "acme/app#1": { status: "in_progress", startedAt: "2025-01-01T00:00:00Z" },
        "acme/app#2": { status: "completed", startedAt: "2025-01-01T00:00:00Z" },
      },
    });
    const output = await captureLog(() => execute({ project: tmpDir }));
    expect(output).toContain("In progress: 1");
    expect(output).toContain("Completed:   1");
    expect(output).toContain("acme/app#1");
  });
});
