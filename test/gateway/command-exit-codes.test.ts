import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { execFile } from "child_process";
import { join } from "path";
import type { Server } from "http";
import { registerLockRoutes } from "../../src/gateway/routes/locks.js";
import { registerCallRoutes, type CallDispatcher } from "../../src/gateway/routes/calls.js";
import { LockStore } from "../../src/gateway/lock-store.js";
import { CallStore } from "../../src/gateway/call-store.js";
import type { ContainerRegistration } from "../../src/gateway/types.js";

const BIN = join(import.meta.dirname, "../../docker/bin");
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function run(
  script: string,
  args: string[],
  envVars: Record<string, string>,
  stdin?: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      join(BIN, script),
      args,
      {
        env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, ...envVars },
        timeout: 30_000,
        encoding: "utf-8",
      },
      (error, stdout, stderr) => {
        // execFile sets error.code to exit code for non-zero exits
        let exitCode = 0;
        if (error) {
          exitCode = typeof (error as any).code === "number" ? (error as any).code : 1;
        }
        resolve({
          exitCode,
          stdout: (stdout ?? "").trim(),
          stderr: (stderr ?? "").trim(),
        });
      },
    );
    if (stdin != null) {
      child.stdin?.write(stdin);
      child.stdin?.end();
    } else {
      child.stdin?.end();
    }
  });
}

describe("command exit codes", () => {
  let server: Server;
  let port: number;
  let app: Hono;
  let registry: Map<string, ContainerRegistration>;
  let lockStore: LockStore;
  let callStore: CallStore;
  let currentDispatcher: CallDispatcher | undefined;

  function gatewayUrl() {
    return `http://127.0.0.1:${port}`;
  }

  function register(secret: string, agentName: string, instanceId?: string) {
    registry.set(secret, {
      containerName: `al-${agentName}-1234`,
      agentName,
      instanceId: instanceId || agentName,
    });
  }

  function env(secret: string) {
    return { GATEWAY_URL: gatewayUrl(), SHUTDOWN_SECRET: secret };
  }

  beforeAll(async () => {
    app = new Hono();
    registry = new Map();
    lockStore = new LockStore(300, 9999);
    callStore = new CallStore(9999);
    currentDispatcher = (entry) => {
      callStore.setRunning(entry.callId);
      return { ok: true };
    };

    registerLockRoutes(app, registry, lockStore, logger as any);
    registerCallRoutes(
      app,
      registry,
      callStore,
      () => currentDispatcher,
      logger as any,
    );

    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }) as Server;
      server.on("listening", () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(() => {
    server?.close();
    lockStore?.dispose();
    callStore?.dispose();
  });

  afterEach(() => {
    for (const [, reg] of registry) {
      lockStore.releaseAll(reg.instanceId);
    }
  });

  // ---------- rlock ----------

  describe("rlock", () => {
    it("exit 0 — acquires a free lock", async () => {
      register("sec-a", "agent-a");
      const r = await run("rlock", ["res-1"], env("sec-a"));
      expect(r.exitCode).toBe(0);
      const body = JSON.parse(r.stdout);
      expect(body.ok).toBe(true);
    });

    it("exit 1 — conflict when held by another", async () => {
      register("sec-a", "agent-a");
      register("sec-b", "agent-b");
      await run("rlock", ["res-1"], env("sec-a"));
      const r = await run("rlock", ["res-1"], env("sec-b"));
      expect(r.exitCode).toBe(1);
      const body = JSON.parse(r.stdout);
      expect(body.ok).toBe(false);
      expect(body.holder).toBeTruthy();
    });

    it("exit 0 — acquiring multiple locks succeeds", async () => {
      register("sec-a", "agent-a");
      await run("rlock", ["res-1"], env("sec-a"));
      const r = await run("rlock", ["res-2"], env("sec-a"));
      expect(r.exitCode).toBe(0);
      const body = JSON.parse(r.stdout);
      expect(body.ok).toBe(true);
    });

    it("exit 3 — invalid secret", async () => {
      const r = await run("rlock", ["res-1"], env("bad-secret"));
      expect(r.exitCode).toBe(3);
    });

    it("exit 9 — missing arg (usage error)", async () => {
      register("sec-a", "agent-a");
      const r = await run("rlock", [], env("sec-a"));
      expect(r.exitCode).toBe(9);
      const body = JSON.parse(r.stdout);
      expect(body.ok).toBe(false);
    });

    it("exit 0 — graceful degradation when no gateway", async () => {
      const r = await run("rlock", ["res-1"], { GATEWAY_URL: "", SHUTDOWN_SECRET: "x" });
      expect(r.exitCode).toBe(0);
      const body = JSON.parse(r.stdout);
      expect(body.ok).toBe(true);
    });
  });

  // ---------- runlock ----------

  describe("runlock", () => {
    it("exit 0 — releases held lock", async () => {
      register("sec-a", "agent-a");
      await run("rlock", ["res-1"], env("sec-a"));
      const r = await run("runlock", ["res-1"], env("sec-a"));
      expect(r.exitCode).toBe(0);
      const body = JSON.parse(r.stdout);
      expect(body.ok).toBe(true);
    });

    it("exit 1 — lock held by another", async () => {
      register("sec-a", "agent-a");
      register("sec-b", "agent-b");
      await run("rlock", ["res-1"], env("sec-a"));
      const r = await run("runlock", ["res-1"], env("sec-b"));
      expect(r.exitCode).toBe(1);
    });

    it("exit 2 — lock not found", async () => {
      register("sec-a", "agent-a");
      const r = await run("runlock", ["nonexistent"], env("sec-a"));
      expect(r.exitCode).toBe(2);
    });

    it("exit 3 — invalid secret", async () => {
      const r = await run("runlock", ["res-1"], env("bad-secret"));
      expect(r.exitCode).toBe(3);
    });

    it("exit 9 — missing arg (usage error)", async () => {
      register("sec-a", "agent-a");
      const r = await run("runlock", [], env("sec-a"));
      expect(r.exitCode).toBe(9);
    });

    it("exit 0 — graceful degradation when no gateway", async () => {
      const r = await run("runlock", ["res-1"], { GATEWAY_URL: "", SHUTDOWN_SECRET: "x" });
      expect(r.exitCode).toBe(0);
    });
  });

  // ---------- rlock-heartbeat ----------

  describe("rlock-heartbeat", () => {
    it("exit 0 — extends held lock", async () => {
      register("sec-a", "agent-a");
      await run("rlock", ["res-1"], env("sec-a"));
      const r = await run("rlock-heartbeat", ["res-1"], env("sec-a"));
      expect(r.exitCode).toBe(0);
      const body = JSON.parse(r.stdout);
      expect(body.ok).toBe(true);
      expect(body.expiresAt).toBeTruthy();
    });

    it("exit 1 — lock held by another", async () => {
      register("sec-a", "agent-a");
      register("sec-b", "agent-b");
      await run("rlock", ["res-1"], env("sec-a"));
      const r = await run("rlock-heartbeat", ["res-1"], env("sec-b"));
      expect(r.exitCode).toBe(1);
    });

    it("exit 2 — lock not found", async () => {
      register("sec-a", "agent-a");
      const r = await run("rlock-heartbeat", ["nonexistent"], env("sec-a"));
      expect(r.exitCode).toBe(2);
    });

    it("exit 3 — invalid secret", async () => {
      const r = await run("rlock-heartbeat", ["res-1"], env("bad-secret"));
      expect(r.exitCode).toBe(3);
    });

    it("exit 9 — missing arg (usage error)", async () => {
      register("sec-a", "agent-a");
      const r = await run("rlock-heartbeat", [], env("sec-a"));
      expect(r.exitCode).toBe(9);
    });

    it("exit 0 — graceful degradation when no gateway", async () => {
      const r = await run("rlock-heartbeat", ["res-1"], { GATEWAY_URL: "", SHUTDOWN_SECRET: "x" });
      expect(r.exitCode).toBe(0);
    });
  });

  // ---------- al-call ----------

  describe("al-call", () => {
    it("exit 0 — dispatches call", async () => {
      register("sec-a", "agent-a");
      register("sec-b", "agent-b");
      const r = await run("al-call", ["agent-b"], env("sec-a"), "do work");
      expect(r.exitCode).toBe(0);
      const body = JSON.parse(r.stdout);
      expect(body.ok).toBe(true);
      expect(body.callId).toBeTruthy();
    });

    it("exit 1 — dispatch rejected", async () => {
      register("sec-a", "agent-a");
      const savedDispatcher = currentDispatcher;
      currentDispatcher = () => ({ ok: false, reason: "agent busy" });
      const r = await run("al-call", ["agent-b"], env("sec-a"), "do work");
      expect(r.exitCode).toBe(1);
      currentDispatcher = savedDispatcher;
    });

    it("exit 3 — invalid secret", async () => {
      const r = await run("al-call", ["agent-b"], env("bad-secret"), "do work");
      expect(r.exitCode).toBe(3);
    });

    it("exit 9 — missing arg (usage error)", async () => {
      register("sec-a", "agent-a");
      const r = await run("al-call", [], env("sec-a"), "do work");
      expect(r.exitCode).toBe(9);
    });

    it("exit 5 — no gateway", async () => {
      const r = await run("al-call", ["agent-b"], { GATEWAY_URL: "", SHUTDOWN_SECRET: "x" });
      expect(r.exitCode).toBe(5);
    });
  });

  // ---------- al-check ----------

  describe("al-check", () => {
    it("exit 0 — checks running call", async () => {
      register("sec-a", "agent-a");
      register("sec-b", "agent-b");
      const callResult = await run("al-call", ["agent-b"], env("sec-a"), "do work");
      const callId = JSON.parse(callResult.stdout).callId;
      const r = await run("al-check", [callId], env("sec-a"));
      expect(r.exitCode).toBe(0);
      const body = JSON.parse(r.stdout);
      expect(body.status).toBeTruthy();
    });

    it("exit 2 — call not found", async () => {
      register("sec-a", "agent-a");
      const r = await run("al-check", ["nonexistent-id"], env("sec-a"));
      expect(r.exitCode).toBe(2);
    });

    it("exit 3 — invalid secret", async () => {
      const r = await run("al-check", ["some-id"], env("bad-secret"));
      expect(r.exitCode).toBe(3);
    });

    it("exit 9 — missing arg (usage error)", async () => {
      register("sec-a", "agent-a");
      const r = await run("al-check", [], env("sec-a"));
      expect(r.exitCode).toBe(9);
    });

    it("exit 5 — no gateway", async () => {
      const r = await run("al-check", ["some-id"], { GATEWAY_URL: "", SHUTDOWN_SECRET: "x" });
      expect(r.exitCode).toBe(5);
    });
  });

  // ---------- al-wait ----------

  describe("al-wait", () => {
    it("exit 0 — all calls complete", async () => {
      register("sec-a", "agent-a");
      register("sec-b", "agent-b");
      const callResult = await run("al-call", ["agent-b"], env("sec-a"), "do work");
      const callId = JSON.parse(callResult.stdout).callId;
      callStore.complete(callId, "done");
      const r = await run("al-wait", [callId, "--timeout", "10"], env("sec-a"));
      expect(r.exitCode).toBe(0);
      const body = JSON.parse(r.stdout);
      expect(body[callId]).toBeTruthy();
      expect(body[callId].status).toBe("completed");
    });

    it("exit 8 — timeout", async () => {
      register("sec-a", "agent-a");
      register("sec-b", "agent-b");
      const callResult = await run("al-call", ["agent-b"], env("sec-a"), "do work");
      const callId = JSON.parse(callResult.stdout).callId;
      // Don't complete — it stays running, timeout after 1s (one poll cycle)
      const r = await run("al-wait", [callId, "--timeout", "1"], env("sec-a"));
      expect(r.exitCode).toBe(8);
    }, 15_000);

    it("exit 9 — missing arg (usage error)", async () => {
      const r = await run("al-wait", [], env("sec-a"));
      expect(r.exitCode).toBe(9);
    });

    it("exit 5 — no gateway", async () => {
      const r = await run("al-wait", ["some-id"], { GATEWAY_URL: "", SHUTDOWN_SECRET: "x" });
      expect(r.exitCode).toBe(5);
    });
  });

  // ---------- al-status ----------

  describe("al-status", () => {
    it("exit 9 — missing arg (usage error)", async () => {
      const r = await run("al-status", [], {
        GATEWAY_URL: "",
        SHUTDOWN_SECRET: "",
        AL_SIGNAL_DIR: "/tmp/al-test-signals",
      });
      expect(r.exitCode).toBe(9);
      const body = JSON.parse(r.stdout);
      expect(body.ok).toBe(false);
    });
  });
});
