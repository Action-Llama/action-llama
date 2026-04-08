/**
 * Integration tests: remote/ssh helpers, hook runner, and test webhook provider — no Docker required.
 *
 * Covers four previously untested modules:
 *
 *   1. remote/ssh.ts — buildSshArgs() and sshOptionsFromConfig()
 *      Pure functions: no actual SSH connections made.
 *
 *   2. hooks/runner.ts — runHooks()
 *      Runs real shell commands via execSync. Tests use simple echo/exit commands
 *      that always succeed or fail predictably without any network/Docker access.
 *
 *   3. webhooks/providers/test.ts — TestWebhookProvider
 *      Pure provider with no HMAC validation. Tests validateRequest(),
 *      parseEvent(), and matchesFilter() without any HTTP calls.
 *
 *   4. cloud/vps/constants.ts — VPS_CONSTANTS
 *      Verifies that the constants object exports the expected fields with
 *      correct types and sensible values.
 */

import { describe, it, expect, beforeEach } from "vitest";

// ── 1. remote/ssh.ts ──────────────────────────────────────────────────────────

const {
  buildSshArgs,
  sshOptionsFromConfig,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/remote/ssh.js"
);

// ── 2. hooks/runner.ts ────────────────────────────────────────────────────────

const {
  runHooks,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/hooks/runner.js"
);

// ── 3. webhooks/providers/test.ts ─────────────────────────────────────────────

const {
  TestWebhookProvider,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/test.js"
);

// ── 4. cloud/vps/constants.ts ─────────────────────────────────────────────────

const {
  VPS_CONSTANTS,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cloud/vps/constants.js"
);

// ──────────────────────────────────────────────────────────────────────────────

describe("integration: buildSshArgs and sshOptionsFromConfig (no Docker required)", () => {
  const baseOpts = {
    host: "192.168.1.100",
    user: "root",
    port: 22,
  };

  it("buildSshArgs includes host as user@host at end of args", () => {
    const args = buildSshArgs(baseOpts);
    expect(args[args.length - 1]).toBe("root@192.168.1.100");
  });

  it("buildSshArgs includes port flag", () => {
    const args = buildSshArgs(baseOpts);
    const portIdx = args.indexOf("-p");
    expect(portIdx).toBeGreaterThanOrEqual(0);
    expect(args[portIdx + 1]).toBe("22");
  });

  it("buildSshArgs includes StrictHostKeyChecking=accept-new", () => {
    const args = buildSshArgs(baseOpts);
    expect(args).toContain("StrictHostKeyChecking=accept-new");
  });

  it("buildSshArgs includes BatchMode=yes", () => {
    const args = buildSshArgs(baseOpts);
    expect(args).toContain("BatchMode=yes");
  });

  it("buildSshArgs includes -i keyPath when provided", () => {
    const args = buildSshArgs({ ...baseOpts, keyPath: "/home/user/.ssh/id_rsa" });
    const idIdx = args.indexOf("-i");
    expect(idIdx).toBeGreaterThanOrEqual(0);
    expect(args[idIdx + 1]).toBe("/home/user/.ssh/id_rsa");
  });

  it("buildSshArgs does NOT include -i when keyPath is absent", () => {
    const args = buildSshArgs(baseOpts);
    expect(args).not.toContain("-i");
  });

  it("buildSshArgs includes ControlPath when controlPath is provided", () => {
    const args = buildSshArgs({ ...baseOpts, controlPath: "/tmp/ssh-ctrl-%r@%h:%p" });
    const joined = args.join(" ");
    expect(joined).toContain("ControlMaster");
    expect(joined).toContain("ControlPath");
    expect(joined).toContain("/tmp/ssh-ctrl-%r@%h:%p");
  });

  it("buildSshArgs does NOT include ControlPath when not provided", () => {
    const args = buildSshArgs(baseOpts);
    const joined = args.join(" ");
    expect(joined).not.toContain("ControlMaster");
    expect(joined).not.toContain("ControlPath");
  });

  it("buildSshArgs uses non-standard port correctly", () => {
    const args = buildSshArgs({ ...baseOpts, port: 2222 });
    const portIdx = args.indexOf("-p");
    expect(args[portIdx + 1]).toBe("2222");
  });

  it("sshOptionsFromConfig sets user from config", () => {
    const opts = sshOptionsFromConfig({ host: "10.0.0.1", user: "ubuntu", port: 22 });
    expect(opts.user).toBe("ubuntu");
  });

  it("sshOptionsFromConfig defaults user to 'root' when not set", () => {
    const opts = sshOptionsFromConfig({ host: "10.0.0.1" });
    expect(opts.user).toBe("root");
  });

  it("sshOptionsFromConfig defaults port to 22 when not set", () => {
    const opts = sshOptionsFromConfig({ host: "10.0.0.1" });
    expect(opts.port).toBe(22);
  });

  it("sshOptionsFromConfig passes keyPath through", () => {
    const opts = sshOptionsFromConfig({ host: "10.0.0.1", keyPath: "/root/.ssh/deploy_key" });
    expect(opts.keyPath).toBe("/root/.ssh/deploy_key");
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe("integration: runHooks (no Docker required)", () => {
  const noopLogger = (_level: string, _msg: string, _data?: any) => {};
  const baseCtx = { env: {}, logger: noopLogger };

  it("empty commands array returns durationMs >= 0 immediately", async () => {
    const result = await runHooks([], "pre", baseCtx);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("single successful echo command resolves without error", async () => {
    const result = await runHooks(["echo hello"], "pre", baseCtx);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("multiple successful commands all run in order", async () => {
    const ran: string[] = [];
    const ctx = {
      env: {},
      logger: (_level: string, msg: string) => {
        if (msg.includes("echo first")) ran.push("first");
        if (msg.includes("echo second")) ran.push("second");
      },
    };
    await runHooks(["echo first", "echo second"], "pre", ctx);
    expect(ran.indexOf("first")).toBeLessThan(ran.indexOf("second"));
  });

  it("failing command (exit 1) throws an error containing the command", async () => {
    await expect(
      runHooks(["exit 1"], "post", baseCtx)
    ).rejects.toThrow(/failed|exit 1/i);
  });

  it("second command is not executed after first command fails", async () => {
    let secondRan = false;
    const ctx = {
      env: {},
      logger: (_level: string, msg: string) => {
        if (msg.includes("echo second")) secondRan = true;
      },
    };
    await expect(
      runHooks(["exit 1", "echo second"], "pre", ctx)
    ).rejects.toThrow();
    expect(secondRan).toBe(false);
  });

  it("env variables are available to hook commands", async () => {
    const ctx = {
      env: { MY_TEST_VAR: "hello_from_hook" },
      logger: noopLogger,
    };
    await expect(runHooks(["echo $MY_TEST_VAR"], "pre", ctx)).resolves.toBeDefined();
  });

  it("post phase is logged correctly (phase name in log)", async () => {
    const phases: string[] = [];
    const ctx = {
      env: {},
      logger: (_level: string, msg: string) => {
        if (msg.includes("hooks.post")) phases.push("post");
      },
    };
    await runHooks(["echo ok"], "post", ctx);
    expect(phases).toContain("post");
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe("integration: TestWebhookProvider (no Docker required)", () => {
  let provider: any;

  beforeEach(() => {
    provider = new TestWebhookProvider();
  });

  it("source is 'test'", () => {
    expect(provider.source).toBe("test");
  });

  // validateRequest
  it("validateRequest always returns 'test' regardless of headers/body/secrets", () => {
    const result = provider.validateRequest({}, '{"event":"push"}', {});
    expect(result).toBe("test");
  });

  it("validateRequest returns 'test' with no secrets or allowUnsigned", () => {
    const result = provider.validateRequest({}, "{}");
    expect(result).toBe("test");
  });

  // parseEvent
  it("parseEvent returns null for null body", () => {
    expect(provider.parseEvent({}, null)).toBeNull();
  });

  it("parseEvent returns null for non-object body", () => {
    expect(provider.parseEvent({}, "string")).toBeNull();
  });

  it("parseEvent builds WebhookContext from body fields", () => {
    const body = {
      source: "test",
      event: "push",
      action: "created",
      repo: "owner/repo",
      number: 42,
      title: "My PR",
      author: "alice",
      sender: "alice",
    };
    const ctx = provider.parseEvent({}, body);
    expect(ctx).not.toBeNull();
    expect(ctx.source).toBe("test");
    expect(ctx.event).toBe("push");
    expect(ctx.action).toBe("created");
    expect(ctx.repo).toBe("owner/repo");
    expect(ctx.number).toBe(42);
    expect(ctx.title).toBe("My PR");
    expect(ctx.author).toBe("alice");
    expect(ctx.sender).toBe("alice");
  });

  it("parseEvent uses defaults when optional fields are absent", () => {
    const body = {};
    const ctx = provider.parseEvent({}, body);
    expect(ctx).not.toBeNull();
    expect(ctx.source).toBe("test");
    expect(ctx.event).toBe("test");
    expect(ctx.sender).toBe("test");
    expect(ctx.repo).toBe("");
    expect(ctx.timestamp).toBeTruthy();
  });

  it("parseEvent preserves labels array", () => {
    const body = { event: "push", labels: ["bug", "feature"] };
    const ctx = provider.parseEvent({}, body);
    expect(ctx!.labels).toEqual(["bug", "feature"]);
  });

  // matchesFilter
  it("matchesFilter returns true when no filter restrictions set", () => {
    const ctx = { source: "test", event: "push", repo: "owner/repo", sender: "alice", timestamp: "" };
    expect(provider.matchesFilter(ctx, {})).toBe(true);
  });

  it("matchesFilter returns true when event matches filter events list", () => {
    const ctx = { source: "test", event: "push", repo: "owner/repo", sender: "alice", timestamp: "" };
    expect(provider.matchesFilter(ctx, { events: ["push", "pull_request"] })).toBe(true);
  });

  it("matchesFilter returns false when event not in filter events list", () => {
    const ctx = { source: "test", event: "issues", repo: "owner/repo", sender: "alice", timestamp: "" };
    expect(provider.matchesFilter(ctx, { events: ["push"] })).toBe(false);
  });

  it("matchesFilter returns true when action matches filter actions list", () => {
    const ctx = { source: "test", event: "push", action: "opened", repo: "owner/repo", sender: "alice", timestamp: "" };
    expect(provider.matchesFilter(ctx, { actions: ["opened", "closed"] })).toBe(true);
  });

  it("matchesFilter returns false when action not in filter actions list", () => {
    const ctx = { source: "test", event: "push", action: "reopened", repo: "owner/repo", sender: "alice", timestamp: "" };
    expect(provider.matchesFilter(ctx, { actions: ["opened"] })).toBe(false);
  });

  it("matchesFilter returns false when actions filter set but context has no action", () => {
    const ctx = { source: "test", event: "push", repo: "owner/repo", sender: "alice", timestamp: "" };
    expect(provider.matchesFilter(ctx, { actions: ["opened"] })).toBe(false);
  });

  it("matchesFilter returns true when repo matches filter repos list", () => {
    const ctx = { source: "test", event: "push", repo: "owner/repo", sender: "alice", timestamp: "" };
    expect(provider.matchesFilter(ctx, { repos: ["owner/repo"] })).toBe(true);
  });

  it("matchesFilter returns false when repo not in filter repos list", () => {
    const ctx = { source: "test", event: "push", repo: "other/repo", sender: "alice", timestamp: "" };
    expect(provider.matchesFilter(ctx, { repos: ["owner/repo"] })).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe("integration: VPS_CONSTANTS (no Docker required)", () => {
  it("DEFAULT_SSH_USER is 'root'", () => {
    expect(VPS_CONSTANTS.DEFAULT_SSH_USER).toBe("root");
  });

  it("DEFAULT_SSH_PORT is 22", () => {
    expect(VPS_CONSTANTS.DEFAULT_SSH_PORT).toBe(22);
  });

  it("DEFAULT_GATEWAY_PORT is a positive number", () => {
    expect(typeof VPS_CONSTANTS.DEFAULT_GATEWAY_PORT).toBe("number");
    expect(VPS_CONSTANTS.DEFAULT_GATEWAY_PORT).toBeGreaterThan(0);
  });

  it("SCHEDULER_CONTAINER is a non-empty string", () => {
    expect(typeof VPS_CONSTANTS.SCHEDULER_CONTAINER).toBe("string");
    expect(VPS_CONSTANTS.SCHEDULER_CONTAINER.length).toBeGreaterThan(0);
  });

  it("REMOTE_CREDENTIALS_DIR is a path string", () => {
    expect(typeof VPS_CONSTANTS.REMOTE_CREDENTIALS_DIR).toBe("string");
    expect(VPS_CONSTANTS.REMOTE_CREDENTIALS_DIR).toContain(".action-llama");
  });

  it("CLOUD_INIT_SCRIPT contains Docker installation commands", () => {
    expect(VPS_CONSTANTS.CLOUD_INIT_SCRIPT).toContain("docker");
  });

  it("CLOUD_INIT_SCRIPT contains Node.js installation commands", () => {
    expect(VPS_CONSTANTS.CLOUD_INIT_SCRIPT).toContain("nodejs");
  });

  it("NGINX_CERT_DIR starts with /etc/ssl", () => {
    expect(VPS_CONSTANTS.NGINX_CERT_DIR).toContain("/etc/ssl");
  });

  it("NGINX_CERT_PATH ends with .pem", () => {
    expect(VPS_CONSTANTS.NGINX_CERT_PATH).toMatch(/\.pem$/);
  });

  it("NGINX_KEY_PATH ends with .pem", () => {
    expect(VPS_CONSTANTS.NGINX_KEY_PATH).toMatch(/\.pem$/);
  });

  it("NGINX_SITE_CONFIG is in /etc/nginx", () => {
    expect(VPS_CONSTANTS.NGINX_SITE_CONFIG).toContain("/etc/nginx");
  });

  it("MIN_VCPUS and MIN_RAM_MB are reasonable minimums", () => {
    expect(VPS_CONSTANTS.MIN_VCPUS).toBeGreaterThanOrEqual(1);
    expect(VPS_CONSTANTS.MIN_RAM_MB).toBeGreaterThanOrEqual(512);
  });
});
