import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const thisDir = dirname(fileURLToPath(import.meta.url));
const binDir = resolve(thisDir, "../../docker/bin");

function run(
  shell: string,
  command: string,
  env: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(shell, ["-c", command], {
    encoding: "utf-8",
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      HOME: tmpdir(),
      ...env,
    },
    timeout: 5000,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

describe("al-export", () => {
  let workDir: string;
  let exportFile: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "al-export-test-"));
    exportFile = join(workDir, ".env.sh");
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("prints the export file path with -f", () => {
    const result = run("sh", 'al-export -f', { AL_EXPORT_FILE: exportFile });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(exportFile);
  });

  it("writes export lines to the configured file", () => {
    const result = run("sh", 'al-export REPO "Action-Llama/action-llama"', { AL_EXPORT_FILE: exportFile });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("exported 1 variable");
    expect(existsSync(exportFile)).toBe(true);
    expect(readFileSync(exportFile, "utf-8")).toContain("export REPO='Action-Llama/action-llama'");
  });

  it("supports sourcing persisted exports in a later shell command", () => {
    run("sh", 'al-export REPO "Action-Llama/action-llama" ISSUE_NUMBER 473', { AL_EXPORT_FILE: exportFile });
    const result = run("sh", '. "$(al-export -f)"\nprintf "%s %s" "$REPO" "$ISSUE_NUMBER"', {
      AL_EXPORT_FILE: exportFile,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("Action-Llama/action-llama 473");
  });

  it("rejects invalid variable names", () => {
    const result = run("sh", 'al-export "123invalid" value', { AL_EXPORT_FILE: exportFile });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid variable name");
  });
});
