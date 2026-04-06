/**
 * Integration tests: agents/signals.ts installSignalCommands() — no Docker required.
 *
 * installSignalCommands() installs shell-based signal scripts used by host-mode
 * agent runners. It creates al-rerun, al-status, al-return, al-exit in binDir
 * and copies al-bash-init.sh from the package's docker/bin/ directory.
 *
 * Test scenarios (no Docker required):
 *   1. installSignalCommands: creates binDir if it does not exist
 *   2. installSignalCommands: creates signalDir if it does not exist
 *   3. installSignalCommands: creates al-rerun in binDir
 *   4. installSignalCommands: creates al-status in binDir
 *   5. installSignalCommands: creates al-return in binDir
 *   6. installSignalCommands: creates al-exit in binDir
 *   7. installSignalCommands: copies al-bash-init.sh to binDir
 *   8. installSignalCommands: al-rerun is executable (mode includes 0o755)
 *   9. installSignalCommands: al-status script checks for empty argument
 *  10. installSignalCommands: al-rerun starts with #!/bin/sh shebang
 *  11. installSignalCommands: al-status starts with #!/bin/sh shebang
 *  12. installSignalCommands: al-return starts with #!/bin/sh shebang
 *  13. installSignalCommands: al-exit starts with #!/bin/sh shebang
 *  14. installSignalCommands: al-exit contains CODE with default 15
 *  15. installSignalCommands: al-rerun writes to $AL_SIGNAL_DIR/rerun
 *  16. installSignalCommands: al-status writes to $AL_SIGNAL_DIR/status
 *  17. installSignalCommands: al-return writes to $AL_SIGNAL_DIR/return
 *  18. installSignalCommands: works with nested binDir path (recursive mkdir)
 *  19. installSignalCommands: two separate calls produce independent directories
 *  20. installSignalCommands: al-bash-init.sh content matches original source
 *
 * Covers:
 *   - agents/signals.ts: installSignalCommands() — all file writes
 *   - agents/signals.ts: installSignalCommands() — binDir/signalDir creation
 *   - agents/signals.ts: installSignalCommands() — al-bash-init.sh copy path
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, statSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { installSignalCommands } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/agents/signals.js"
);

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "al-install-signals-test-"));
}

const dirsToCleanup: string[] = [];

afterEach(() => {
  for (const dir of dirsToCleanup) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  dirsToCleanup.length = 0;
});

describe(
  "integration: agents/signals.ts installSignalCommands() (no Docker required)",
  { timeout: 15_000 },
  () => {

    // ── Directory creation ───────────────────────────────────────────────────

    it("creates binDir if it does not exist", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      const signalDir = join(base, "signals");
      expect(existsSync(binDir)).toBe(false);
      installSignalCommands(binDir, signalDir);
      expect(existsSync(binDir)).toBe(true);
    });

    it("creates signalDir if it does not exist", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      const signalDir = join(base, "signals");
      expect(existsSync(signalDir)).toBe(false);
      installSignalCommands(binDir, signalDir);
      expect(existsSync(signalDir)).toBe(true);
    });

    it("works with nested binDir path (recursive mkdir)", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "a", "b", "c", "bin");
      const signalDir = join(base, "signals");
      expect(() => installSignalCommands(binDir, signalDir)).not.toThrow();
      expect(existsSync(binDir)).toBe(true);
    });

    // ── Script files created ──────────────────────────────────────────────────

    it("creates al-rerun in binDir", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      expect(existsSync(join(binDir, "al-rerun"))).toBe(true);
    });

    it("creates al-status in binDir", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      expect(existsSync(join(binDir, "al-status"))).toBe(true);
    });

    it("creates al-return in binDir", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      expect(existsSync(join(binDir, "al-return"))).toBe(true);
    });

    it("creates al-exit in binDir", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      expect(existsSync(join(binDir, "al-exit"))).toBe(true);
    });

    it("copies al-bash-init.sh to binDir", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      expect(existsSync(join(binDir, "al-bash-init.sh"))).toBe(true);
    });

    // ── Script content: shebangs ──────────────────────────────────────────────

    it("al-rerun starts with #!/bin/sh shebang", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const content = readFileSync(join(binDir, "al-rerun"), "utf-8");
      expect(content.startsWith("#!/bin/sh")).toBe(true);
    });

    it("al-status starts with #!/bin/sh shebang", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const content = readFileSync(join(binDir, "al-status"), "utf-8");
      expect(content.startsWith("#!/bin/sh")).toBe(true);
    });

    it("al-return starts with #!/bin/sh shebang", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const content = readFileSync(join(binDir, "al-return"), "utf-8");
      expect(content.startsWith("#!/bin/sh")).toBe(true);
    });

    it("al-exit starts with #!/bin/sh shebang", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const content = readFileSync(join(binDir, "al-exit"), "utf-8");
      expect(content.startsWith("#!/bin/sh")).toBe(true);
    });

    // ── Script content: behavior ──────────────────────────────────────────────

    it("al-rerun script writes to $AL_SIGNAL_DIR/rerun", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const content = readFileSync(join(binDir, "al-rerun"), "utf-8");
      expect(content).toContain('$AL_SIGNAL_DIR/rerun');
    });

    it("al-status script writes to $AL_SIGNAL_DIR/status", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const content = readFileSync(join(binDir, "al-status"), "utf-8");
      expect(content).toContain('$AL_SIGNAL_DIR/status');
    });

    it("al-return script writes to $AL_SIGNAL_DIR/return", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const content = readFileSync(join(binDir, "al-return"), "utf-8");
      expect(content).toContain('$AL_SIGNAL_DIR/return');
    });

    it("al-exit script writes to $AL_SIGNAL_DIR/exit", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const content = readFileSync(join(binDir, "al-exit"), "utf-8");
      expect(content).toContain('$AL_SIGNAL_DIR/exit');
    });

    it("al-exit uses CODE with default 15", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const content = readFileSync(join(binDir, "al-exit"), "utf-8");
      expect(content).toContain("15");
    });

    it("al-status script checks for empty argument", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const content = readFileSync(join(binDir, "al-status"), "utf-8");
      // Should check if $1 is empty and bail out
      expect(content).toContain('-z "$1"');
    });

    it("al-status script outputs ok:true on success", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const content = readFileSync(join(binDir, "al-status"), "utf-8");
      expect(content).toContain('{"ok":true}');
    });

    it("al-rerun script outputs ok:true on success", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const content = readFileSync(join(binDir, "al-rerun"), "utf-8");
      expect(content).toContain('{"ok":true}');
    });

    // ── File permissions ──────────────────────────────────────────────────────

    it("al-rerun is executable (owner has execute bit)", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const mode = statSync(join(binDir, "al-rerun")).mode;
      // 0o100 = owner execute bit
      expect(mode & 0o100).toBeGreaterThan(0);
    });

    it("al-status is executable (owner has execute bit)", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const mode = statSync(join(binDir, "al-status")).mode;
      expect(mode & 0o100).toBeGreaterThan(0);
    });

    it("al-bash-init.sh is executable (owner has execute bit)", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const mode = statSync(join(binDir, "al-bash-init.sh")).mode;
      expect(mode & 0o100).toBeGreaterThan(0);
    });

    // ── al-bash-init.sh content ───────────────────────────────────────────────

    it("al-bash-init.sh content matches the original source file", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const installed = readFileSync(join(binDir, "al-bash-init.sh"));
      const source = readFileSync(
        "/tmp/repo/packages/action-llama/docker/bin/al-bash-init.sh"
      );
      expect(installed).toEqual(source);
    });

    it("al-bash-init.sh is non-empty after installation", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const content = readFileSync(join(binDir, "al-bash-init.sh"), "utf-8");
      expect(content.length).toBeGreaterThan(0);
    });

    // ── Independence ──────────────────────────────────────────────────────────

    it("two separate calls produce independent directories with all scripts", () => {
      const base1 = makeTempDir();
      const base2 = makeTempDir();
      dirsToCleanup.push(base1, base2);
      const binDir1 = join(base1, "bin");
      const binDir2 = join(base2, "bin");
      installSignalCommands(binDir1, join(base1, "signals"));
      installSignalCommands(binDir2, join(base2, "signals"));
      for (const script of ["al-rerun", "al-status", "al-return", "al-exit", "al-bash-init.sh"]) {
        expect(existsSync(join(binDir1, script))).toBe(true);
        expect(existsSync(join(binDir2, script))).toBe(true);
      }
    });

    it("is idempotent — calling twice on same dirs does not throw", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      const signalDir = join(base, "signals");
      installSignalCommands(binDir, signalDir);
      expect(() => installSignalCommands(binDir, signalDir)).not.toThrow();
    });

    // ── GATEWAY_URL integration hints ────────────────────────────────────────

    it("al-rerun includes GATEWAY_URL reference for real-time updates", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const content = readFileSync(join(binDir, "al-rerun"), "utf-8");
      expect(content).toContain("GATEWAY_URL");
    });

    it("al-status includes GATEWAY_URL reference for real-time updates", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const content = readFileSync(join(binDir, "al-status"), "utf-8");
      expect(content).toContain("GATEWAY_URL");
    });

    it("al-rerun uses signals/rerun endpoint path", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const content = readFileSync(join(binDir, "al-rerun"), "utf-8");
      expect(content).toContain("/signals/rerun");
    });

    it("al-status uses signals/status endpoint path", () => {
      const base = makeTempDir();
      dirsToCleanup.push(base);
      const binDir = join(base, "bin");
      installSignalCommands(binDir, join(base, "signals"));
      const content = readFileSync(join(binDir, "al-status"), "utf-8");
      expect(content).toContain("/signals/status");
    });
  }
);
