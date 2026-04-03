/**
 * Integration tests: setup utility functions — no Docker required.
 *
 * Covers three previously untested modules:
 *
 *   1. setup/validators.ts — validateOAuthTokenFormat()
 *      Pure synchronous function that validates the format of Anthropic OAuth
 *      tokens. No network calls — just a string prefix check.
 *
 *   2. setup/scaffold.ts — resolvePackageRoot() and scaffoldAgent()
 *      resolvePackageRoot() returns a filesystem path; scaffoldAgent() creates
 *      SKILL.md and config.toml files in a temp directory. No Docker needed.
 *
 *   3. gateway/middleware/request-logging.ts — applyRequestLoggingMiddleware()
 *      Registers a Hono middleware that logs requests.  Tests verify that
 *      /health is skipped, non-error responses emit debug-level log entries,
 *      and 4xx responses emit warn-level entries — all using in-memory Hono
 *      instances without a real HTTP server.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ── 1. setup/validators.ts ────────────────────────────────────────────────────

const {
  validateOAuthTokenFormat,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/setup/validators.js"
);

// ── 2. setup/scaffold.ts ──────────────────────────────────────────────────────

const {
  resolvePackageRoot,
  scaffoldAgent,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/setup/scaffold.js"
);

// ── 3. gateway/middleware/request-logging.ts ──────────────────────────────────

const {
  applyRequestLoggingMiddleware,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/gateway/middleware/request-logging.js"
);

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

// ──────────────────────────────────────────────────────────────────────────────

describe("integration: validateOAuthTokenFormat (no Docker required)", () => {
  it("returns true for a token containing 'sk-ant-oat'", () => {
    expect(validateOAuthTokenFormat("sk-ant-oat01-abcdefg")).toBe(true);
  });

  it("returns true for a token with sk-ant-oat prefix exactly", () => {
    expect(validateOAuthTokenFormat("sk-ant-oat-long-token-value")).toBe(true);
  });

  it("throws for a regular API key (no sk-ant-oat)", () => {
    expect(() => validateOAuthTokenFormat("sk-ant-api-abcdefg")).toThrow(/oauth token/i);
  });

  it("throws for an empty string", () => {
    expect(() => validateOAuthTokenFormat("")).toThrow();
  });

  it("throws for an OpenAI key", () => {
    expect(() => validateOAuthTokenFormat("sk-openai-abcdef")).toThrow();
  });

  it("throws for an arbitrary string", () => {
    expect(() => validateOAuthTokenFormat("not-a-token")).toThrow();
  });

  it("error message mentions API key option for non-OAuth tokens", () => {
    try {
      validateOAuthTokenFormat("sk-ant-api-key");
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.message).toContain("API key");
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe("integration: resolvePackageRoot and scaffoldAgent (no Docker required)", () => {
  it("resolvePackageRoot returns a non-empty string path", () => {
    const root = resolvePackageRoot();
    expect(typeof root).toBe("string");
    expect(root.length).toBeGreaterThan(0);
  });

  it("resolvePackageRoot returns a path that exists on disk", () => {
    const root = resolvePackageRoot();
    expect(existsSync(root)).toBe(true);
  });

  it("scaffoldAgent creates SKILL.md in the agent directory", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "al-scaffold-test-"));
    try {
      scaffoldAgent(projectPath, {
        name: "my-agent",
        config: {
          name: "my-agent",
          models: [],
          credentials: [],
          schedule: "0 * * * *",
        },
      });
      const skillPath = join(projectPath, "agents", "my-agent", "SKILL.md");
      expect(existsSync(skillPath)).toBe(true);
      const content = readFileSync(skillPath, "utf-8");
      expect(content).toContain("my-agent");
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("scaffoldAgent creates config.toml in the agent directory", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "al-scaffold-test-"));
    try {
      scaffoldAgent(projectPath, {
        name: "my-agent",
        config: {
          name: "my-agent",
          models: [],
          credentials: [],
          schedule: "0 * * * *",
        },
      });
      const configPath = join(projectPath, "agents", "my-agent", "config.toml");
      expect(existsSync(configPath)).toBe(true);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("scaffoldAgent does not overwrite existing SKILL.md", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "al-scaffold-test-"));
    try {
      // First scaffold creates the files
      scaffoldAgent(projectPath, {
        name: "agent-x",
        config: { name: "agent-x", models: [], credentials: [] },
      });

      const skillPath = join(projectPath, "agents", "agent-x", "SKILL.md");
      const originalContent = readFileSync(skillPath, "utf-8");
      const originalModified = existsSync(skillPath);

      // Second scaffold should not overwrite
      scaffoldAgent(projectPath, {
        name: "agent-x",
        config: { name: "agent-x", models: [], credentials: [], description: "NEW DESCRIPTION" },
      });

      const newContent = readFileSync(skillPath, "utf-8");
      expect(newContent).toBe(originalContent);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("scaffoldAgent includes description in SKILL.md frontmatter when provided", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "al-scaffold-test-"));
    try {
      scaffoldAgent(projectPath, {
        name: "described-agent",
        config: {
          name: "described-agent",
          models: [],
          credentials: [],
          description: "Does important things",
        },
      });
      const skillPath = join(projectPath, "agents", "described-agent", "SKILL.md");
      const content = readFileSync(skillPath, "utf-8");
      expect(content).toContain("Does important things");
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe("integration: applyRequestLoggingMiddleware (no Docker required)", () => {
  it("registers middleware on the Hono app without throwing", () => {
    const app = new Hono();
    const logs: Array<{ level: string; msg: string }> = [];
    const logger = {
      debug: (_data: any, msg: string) => logs.push({ level: "debug", msg }),
      warn: (_data: any, msg: string) => logs.push({ level: "warn", msg }),
      info: (_data: any, msg: string) => logs.push({ level: "info", msg }),
      error: (_data: any, msg: string) => logs.push({ level: "error", msg }),
    };

    expect(() => applyRequestLoggingMiddleware(app, logger)).not.toThrow();
  });

  it("/health request bypasses logging middleware", async () => {
    const app = new Hono();
    let debugCalled = false;
    const logger = {
      debug: (_data: any, msg: string) => { debugCalled = true; },
      warn: () => {},
      info: () => {},
      error: () => {},
    };

    applyRequestLoggingMiddleware(app, logger);
    app.get("/health", (c) => c.json({ status: "ok" }));

    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(debugCalled).toBe(false);
  });

  it("non-/health request triggers debug log for 200 response", async () => {
    const app = new Hono();
    const debugMsgs: string[] = [];
    const logger = {
      debug: (_data: any, msg: string) => { debugMsgs.push(msg); },
      warn: () => {},
      info: () => {},
      error: () => {},
    };

    applyRequestLoggingMiddleware(app, logger);
    app.get("/api/test", (c) => c.json({ ok: true }));

    const res = await app.request("/api/test");
    expect(res.status).toBe(200);
    // Debug log was called for non-health endpoint
    expect(debugMsgs.some((m) => m.includes("received") || m.includes("completed"))).toBe(true);
  });

  it("4xx response triggers warn log instead of debug", async () => {
    const app = new Hono();
    const warnMsgs: string[] = [];
    const logger = {
      debug: () => {},
      warn: (_data: any, msg: string) => { warnMsgs.push(msg); },
      info: () => {},
      error: () => {},
    };

    applyRequestLoggingMiddleware(app, logger);
    app.get("/api/missing", (c) => c.json({ err: "not found" }, 404));

    const res = await app.request("/api/missing");
    expect(res.status).toBe(404);
    expect(warnMsgs.length).toBeGreaterThan(0);
  });
});
