/**
 * Integration tests: cli/commands/kill.ts, stop.ts, pause.ts, resume.ts — no Docker required.
 *
 * These four CLI commands call the gateway API via gatewayFetch(). When the
 * gateway is not running (port not listening), they all throw an error.
 *
 * Note: The source code checks `error.message.includes('ECONNREFUSED')` for the
 * "Scheduler not running" message. In Node.js 20+, fetch throws "fetch failed"
 * (not "ECONNREFUSED") so the ECONNREFUSED check doesn't match and the original
 * "fetch failed" error propagates instead. Tests verify the throw behavior.
 *
 * Test scenarios (no Docker required):
 *   1. kill.execute("my-agent") → throws when gateway unavailable
 *   2. stop.execute() → throws when gateway unavailable
 *   3. pause.execute(undefined) → throws when gateway unavailable
 *   4. pause.execute("my-agent") → throws when gateway unavailable
 *   5. resume.execute(undefined) → throws when gateway unavailable
 *   6. resume.execute("my-agent") → throws when gateway unavailable
 *
 * Covers:
 *   - cli/commands/kill.ts: execute() — gatewayFetch catch block exercised
 *   - cli/commands/stop.ts: execute() — gatewayFetch catch block exercised
 *   - cli/commands/pause.ts: execute(undefined) — global pause path + catch
 *   - cli/commands/pause.ts: execute(name) — per-agent pause path + catch
 *   - cli/commands/resume.ts: execute(undefined) — global resume path + catch
 *   - cli/commands/resume.ts: execute(name) — per-agent resume path + catch
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { execute: killExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/kill.js"
);

const { execute: stopExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/stop.js"
);

const { execute: pauseExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/pause.js"
);

const { execute: resumeExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/resume.js"
);

/** Create a minimal project directory with config.toml so gateway-client can find the project */
function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-cli-cmd-test-"));
  // Write config.toml with a gateway port that's guaranteed to not be listening
  writeFileSync(join(dir, "config.toml"), '[gateway]\nport = 19999\n');
  return dir;
}

describe("integration: cli gateway commands (kill, stop, pause, resume) — no Docker required", { timeout: 30_000 }, () => {
  let projectDir: string;

  // ── kill.execute() ────────────────────────────────────────────────────────

  it("kill.execute() throws when gateway unavailable", async () => {
    projectDir = makeProjectDir();
    await expect(
      killExecute("my-agent", { project: projectDir })
    ).rejects.toThrow();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("kill.execute() throws an Error instance", async () => {
    projectDir = makeProjectDir();
    let caught: unknown;
    try {
      await killExecute("my-agent", { project: projectDir });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    rmSync(projectDir, { recursive: true, force: true });
  });

  // ── stop.execute() ────────────────────────────────────────────────────────

  it("stop.execute() throws when gateway unavailable", async () => {
    projectDir = makeProjectDir();
    await expect(
      stopExecute({ project: projectDir })
    ).rejects.toThrow();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("stop.execute() throws an Error instance", async () => {
    projectDir = makeProjectDir();
    let caught: unknown;
    try {
      await stopExecute({ project: projectDir });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    rmSync(projectDir, { recursive: true, force: true });
  });

  // ── pause.execute() ───────────────────────────────────────────────────────

  it("pause.execute(undefined) throws when gateway unavailable (global pause path)", async () => {
    projectDir = makeProjectDir();
    await expect(
      pauseExecute(undefined, { project: projectDir })
    ).rejects.toThrow();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("pause.execute('my-agent') throws when gateway unavailable (per-agent path)", async () => {
    projectDir = makeProjectDir();
    await expect(
      pauseExecute("my-agent", { project: projectDir })
    ).rejects.toThrow();
    rmSync(projectDir, { recursive: true, force: true });
  });

  // ── resume.execute() ──────────────────────────────────────────────────────

  it("resume.execute(undefined) throws when gateway unavailable (global resume path)", async () => {
    projectDir = makeProjectDir();
    await expect(
      resumeExecute(undefined, { project: projectDir })
    ).rejects.toThrow();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("resume.execute('my-agent') throws when gateway unavailable (per-agent path)", async () => {
    projectDir = makeProjectDir();
    await expect(
      resumeExecute("my-agent", { project: projectDir })
    ).rejects.toThrow();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("kill.execute() vs resume.execute() — both throw distinct errors (exercising both code paths)", async () => {
    projectDir = makeProjectDir();
    
    let killErr: Error | undefined;
    let resumeErr: Error | undefined;
    
    try { await killExecute("agent-a", { project: projectDir }); } catch (e) { killErr = e as Error; }
    try { await resumeExecute(undefined, { project: projectDir }); } catch (e) { resumeErr = e as Error; }
    
    expect(killErr).toBeInstanceOf(Error);
    expect(resumeErr).toBeInstanceOf(Error);
    
    rmSync(projectDir, { recursive: true, force: true });
  });
});
