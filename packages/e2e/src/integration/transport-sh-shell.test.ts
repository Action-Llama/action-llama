/**
 * Integration test: verify that DockerExecTransport works with `sh` (not bash)
 * on Alpine-based images.
 *
 * This test provisions a real `node:20-alpine` container (which has no bash),
 * connects via DockerExecTransport, and verifies command execution works.
 *
 * Covers: bash → sh migration — ensures the transport layer works on images
 * that only provide POSIX sh (Alpine, BusyBox, minimal distros).
 */
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: transport sh shell compatibility", { timeout: 60_000 }, () => {
  let containerName: string | undefined;

  afterEach(() => {
    if (containerName) {
      try {
        execFileSync("docker", ["rm", "-f", containerName], {
          timeout: 10_000,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch { /* best effort */ }
      containerName = undefined;
    }
  });

  it("connects and executes commands on Alpine (no bash)", async () => {
    const { DockerExecTransport } = await import("@action-llama/pi-remote");

    // Provision a bare Alpine container (no bash installed)
    containerName = `al-test-sh-${Date.now()}`;
    execFileSync("docker", [
      "run", "-d", "--name", containerName,
      "--tmpfs", "/tmp:rw,exec,nosuid",
      "node:20-alpine", "tail", "-f", "/dev/null",
    ], { timeout: 30_000 });

    // Verify bash is NOT available
    try {
      execFileSync("docker", ["exec", containerName, "which", "bash"], {
        timeout: 5_000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      // If bash IS available, the test is still valid — but note it
    } catch {
      // Expected: bash is not available on Alpine
    }

    // Connect via transport (uses sh, not bash)
    const transport = new DockerExecTransport({
      container: containerName,
      cwd: "/tmp",
    });

    await transport.connect();

    // Execute basic commands
    const echoResult = await transport.exec("echo hello world");
    expect(echoResult.stdout).toBe("hello world");
    expect(echoResult.exitCode).toBe(0);

    // Test exit code capture
    const falseResult = await transport.exec("false");
    expect(falseResult.exitCode).not.toBe(0);

    // Test environment variable persistence across exec calls
    await transport.exec("export MY_VAR=test123");
    const envResult = await transport.exec("echo $MY_VAR");
    expect(envResult.stdout).toBe("test123");

    // Test working directory persistence
    await transport.exec("mkdir -p /tmp/subdir");
    await transport.exec("cd /tmp/subdir");
    const pwdResult = await transport.exec("pwd");
    expect(pwdResult.stdout).toContain("/tmp/subdir");

    // Test file I/O via transport
    const files = new Map<string, Buffer>();
    files.set("/tmp/test-file.txt", Buffer.from("hello from transport"));
    await transport.writeFiles(files);

    const readResult = await transport.exec("cat /tmp/test-file.txt");
    expect(readResult.stdout).toBe("hello from transport");

    const readFiles = await transport.readFiles(["/tmp/test-file.txt"]);
    expect(readFiles.get("/tmp/test-file.txt")?.toString()).toBe("hello from transport");

    await transport.close();
  });

  it("handles multi-line output correctly with sh", async () => {
    const { DockerExecTransport } = await import("@action-llama/pi-remote");

    containerName = `al-test-sh-multiline-${Date.now()}`;
    execFileSync("docker", [
      "run", "-d", "--name", containerName,
      "node:20-alpine", "tail", "-f", "/dev/null",
    ], { timeout: 30_000 });

    const transport = new DockerExecTransport({ container: containerName });
    await transport.connect();

    // Multi-line output
    const result = await transport.exec("echo 'line1\nline2\nline3'");
    expect(result.stdout).toContain("line1");
    expect(result.stdout).toContain("line3");
    expect(result.exitCode).toBe(0);

    await transport.close();
  });
});
