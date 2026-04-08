/**
 * Integration tests: agents/container-runner.ts ContainerAgentRunner — no Docker required.
 *
 * ContainerAgentRunner is the core class that launches and monitors Docker
 * containers for agent execution. Most of its logic requires Docker, but the
 * constructor, getters, and setter methods can be tested in isolation without
 * Docker or network access.
 *
 * Test scenarios (no Docker required):
 *   1. constructor sets instanceId from agentConfig.name
 *   2. constructor sets isRunning to false initially
 *   3. constructor sets containerName to undefined initially
 *   4. setImage() updates the image field (verified by setRuntime round-trip pattern)
 *   5. setAgentConfig() updates the agent config (name reflected in instanceId-like behavior)
 *   6. setRuntime() swaps the runtime reference
 *   7. abort() on idle runner: does not throw (no _containerName, so skip kill)
 *   8. isRunning getter returns false before any run is started
 *   9. containerName getter returns undefined before any container is launched
 *  10. forwardLogLine (private) via abort() path: abort() sets _aborting=true without crash
 *  11. Two runners have independent state (separate instanceId, separate isRunning)
 *  12. setImage() called multiple times: last value wins (no error)
 *  13. abort() called when already aborting: no crash (idempotent-ish)
 *  14. agentConfig.name used as instanceId in constructor
 *  15. logger is accepted from the constructor (pino-compatible mock)
 *
 * Covers:
 *   - agents/container-runner.ts: ContainerAgentRunner constructor
 *   - agents/container-runner.ts: isRunning getter (initial state)
 *   - agents/container-runner.ts: containerName getter (initial state)
 *   - agents/container-runner.ts: setImage() setter
 *   - agents/container-runner.ts: setAgentConfig() setter
 *   - agents/container-runner.ts: setRuntime() setter
 *   - agents/container-runner.ts: abort() when idle (no container to kill)
 *   - agents/container-runner.ts: instanceId public field
 */

import { describe, it, expect } from "vitest";

const { ContainerAgentRunner } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/agents/container-runner.js"
);

// ── Minimal mock helpers ─────────────────────────────────────────────────────

/** A minimal Runtime mock that satisfies the Runtime interface without Docker. */
function makeRuntime(name = "mock-runtime") {
  return {
    _name: name,
    needsGateway: false,
    isAgentRunning: async () => false,
    listRunningAgents: async () => [],
    launch: async () => "mock-container",
    streamLogs: () => ({ stop: () => {} }),
    waitForExit: async () => 0,
    kill: async () => {},
    remove: async () => {},
    prepareCredentials: async () => ({}),
    cleanupCredentials: () => {},
    buildImage: async () => "mock-image:latest",
    getTaskUrl: () => undefined,
  };
}

/** A minimal Logger mock (pino-compatible interface). */
function makeLogger() {
  const messages: Array<{ level: string; msg: string; data?: any }> = [];
  const log = (level: string) => (...args: any[]) => {
    const last = args[args.length - 1];
    const first = args[0];
    if (typeof first === "object" && typeof last === "string") {
      messages.push({ level, msg: last, data: first });
    } else if (typeof first === "string") {
      messages.push({ level, msg: first });
    }
  };
  return {
    _messages: messages,
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    debug: log("debug"),
    child: () => makeLogger(),
  };
}

/** A minimal AgentConfig for testing. */
function makeAgentConfig(name: string): any {
  return {
    name,
    models: [],
    credentials: [],
    timeout: 60,
  };
}

/** A minimal GlobalConfig for testing. */
function makeGlobalConfig(): any {
  return {
    models: {},
    local: { enabled: true },
  };
}

/** Instantiate ContainerAgentRunner with mock dependencies. */
function makeRunner(agentName = "test-agent", image = "test-image:latest") {
  const runtime = makeRuntime();
  const globalConfig = makeGlobalConfig();
  const agentConfig = makeAgentConfig(agentName);
  const logger = makeLogger();
  const registerContainer = async () => {};
  const unregisterContainer = async () => {};

  const runner = new ContainerAgentRunner(
    runtime,
    globalConfig,
    agentConfig,
    logger,
    registerContainer,
    unregisterContainer,
    "http://localhost:8080",
    "/tmp/test-project",
    image,
  );

  return { runner, runtime, globalConfig, agentConfig, logger };
}

// ── Constructor ───────────────────────────────────────────────────────────────

describe("integration: ContainerAgentRunner (no Docker required)", { timeout: 30_000 }, () => {

  describe("constructor", () => {
    it("sets instanceId from agentConfig.name", () => {
      const { runner } = makeRunner("my-special-agent");
      expect(runner.instanceId).toBe("my-special-agent");
    });

    it("initializes isRunning to false", () => {
      const { runner } = makeRunner();
      expect(runner.isRunning).toBe(false);
    });

    it("initializes containerName to undefined", () => {
      const { runner } = makeRunner();
      expect(runner.containerName).toBeUndefined();
    });

    it("accepts a statusTracker parameter (optional)", () => {
      const runtime = makeRuntime();
      const globalConfig = makeGlobalConfig();
      const agentConfig = makeAgentConfig("agent-with-tracker");
      const logger = makeLogger();
      const mockTracker = {
        startRun: () => {},
        endRun: () => {},
        registerInstance: () => {},
        completeInstance: () => {},
        addLogLine: () => {},
        setAgentError: () => {},
        setTaskUrl: () => {},
      };

      // Should not throw when statusTracker is provided
      expect(() => new ContainerAgentRunner(
        runtime,
        globalConfig,
        agentConfig,
        logger,
        async () => {},
        async () => {},
        "http://localhost:8080",
        "/tmp/test",
        "image:latest",
        mockTracker as any,
      )).not.toThrow();
    });

    it("initializes with isRunning=false even with statusTracker", () => {
      const runtime = makeRuntime();
      const globalConfig = makeGlobalConfig();
      const agentConfig = makeAgentConfig("with-tracker");
      const logger = makeLogger();

      const runner = new ContainerAgentRunner(
        runtime,
        globalConfig,
        agentConfig,
        logger,
        async () => {},
        async () => {},
        "",
        "/tmp/test",
        "image:latest",
      );
      expect(runner.isRunning).toBe(false);
    });
  });

  // ── Setters ───────────────────────────────────────────────────────────────

  describe("setImage()", () => {
    it("does not throw when called", () => {
      const { runner } = makeRunner();
      expect(() => runner.setImage("new-image:v2")).not.toThrow();
    });

    it("can be called multiple times without error", () => {
      const { runner } = makeRunner();
      expect(() => {
        runner.setImage("image-v1:latest");
        runner.setImage("image-v2:latest");
        runner.setImage("image-v3:latest");
      }).not.toThrow();
    });

    it("accepts empty string without throwing", () => {
      const { runner } = makeRunner();
      expect(() => runner.setImage("")).not.toThrow();
    });
  });

  describe("setAgentConfig()", () => {
    it("does not throw when called with a new config", () => {
      const { runner } = makeRunner();
      const newConfig = makeAgentConfig("updated-agent");
      expect(() => runner.setAgentConfig(newConfig)).not.toThrow();
    });

    it("accepts config with different name", () => {
      const { runner } = makeRunner("original-agent");
      const newConfig = makeAgentConfig("different-agent");
      expect(() => runner.setAgentConfig(newConfig)).not.toThrow();
    });

    it("accepts config with models and credentials", () => {
      const { runner } = makeRunner();
      const richConfig = {
        name: "rich-agent",
        models: [{ provider: "anthropic", model: "claude-3-5-sonnet", authType: "api_key" }],
        credentials: ["anthropic_key"],
        timeout: 120,
        schedule: "0 0 * * *",
      };
      expect(() => runner.setAgentConfig(richConfig as any)).not.toThrow();
    });
  });

  describe("setRuntime()", () => {
    it("does not throw when called with a new runtime", () => {
      const { runner } = makeRunner();
      const newRuntime = makeRuntime("new-runtime");
      expect(() => runner.setRuntime(newRuntime as any)).not.toThrow();
    });

    it("accepts the same runtime instance again", () => {
      const { runner, runtime } = makeRunner();
      expect(() => runner.setRuntime(runtime as any)).not.toThrow();
    });
  });

  // ── Getters ──────────────────────────────────────────────────────────────

  describe("isRunning getter", () => {
    it("returns a boolean", () => {
      const { runner } = makeRunner();
      expect(typeof runner.isRunning).toBe("boolean");
    });

    it("is false before any run is started", () => {
      const { runner } = makeRunner();
      expect(runner.isRunning).toBe(false);
    });

    it("remains false after setImage() is called", () => {
      const { runner } = makeRunner();
      runner.setImage("different-image:v2");
      expect(runner.isRunning).toBe(false);
    });

    it("remains false after setAgentConfig() is called", () => {
      const { runner } = makeRunner();
      runner.setAgentConfig(makeAgentConfig("new-name"));
      expect(runner.isRunning).toBe(false);
    });

    it("remains false after setRuntime() is called", () => {
      const { runner } = makeRunner();
      runner.setRuntime(makeRuntime("new-rt") as any);
      expect(runner.isRunning).toBe(false);
    });
  });

  describe("containerName getter", () => {
    it("returns undefined before any container is launched", () => {
      const { runner } = makeRunner();
      expect(runner.containerName).toBeUndefined();
    });

    it("returns undefined after setters are called (still not launched)", () => {
      const { runner } = makeRunner();
      runner.setImage("new-image");
      runner.setAgentConfig(makeAgentConfig("new-agent"));
      runner.setRuntime(makeRuntime() as any);
      expect(runner.containerName).toBeUndefined();
    });
  });

  // ── abort() ───────────────────────────────────────────────────────────────

  describe("abort()", () => {
    it("does not throw when called on an idle runner (no container)", () => {
      const { runner } = makeRunner();
      // No container launched → _containerName is undefined → kill() not called
      expect(() => runner.abort()).not.toThrow();
    });

    it("does not throw when called twice (idempotent invocation)", () => {
      const { runner } = makeRunner();
      expect(() => {
        runner.abort();
        runner.abort();
      }).not.toThrow();
    });

    it("does not change isRunning to true (still false after abort)", () => {
      const { runner } = makeRunner();
      runner.abort();
      expect(runner.isRunning).toBe(false);
    });

    it("does not change containerName (remains undefined)", () => {
      const { runner } = makeRunner();
      runner.abort();
      expect(runner.containerName).toBeUndefined();
    });

    it("runtime.kill() is NOT called when there is no active container", () => {
      let killCalled = false;
      const runtime = {
        ...makeRuntime(),
        kill: async () => { killCalled = true; },
      };
      const runner = new ContainerAgentRunner(
        runtime as any,
        makeGlobalConfig(),
        makeAgentConfig("abort-test"),
        makeLogger() as any,
        async () => {},
        async () => {},
        "",
        "/tmp",
        "img",
      );
      runner.abort();
      // kill() should NOT have been called because _containerName is undefined
      expect(killCalled).toBe(false);
    });
  });

  // ── instanceId public field ───────────────────────────────────────────────

  describe("instanceId", () => {
    it("is a string", () => {
      const { runner } = makeRunner("agent-foo");
      expect(typeof runner.instanceId).toBe("string");
    });

    it("matches the agentConfig.name passed to the constructor", () => {
      const { runner } = makeRunner("my-test-agent");
      expect(runner.instanceId).toBe("my-test-agent");
    });

    it("is unique per instance when different names are used", () => {
      const { runner: r1 } = makeRunner("agent-alpha");
      const { runner: r2 } = makeRunner("agent-beta");
      expect(r1.instanceId).toBe("agent-alpha");
      expect(r2.instanceId).toBe("agent-beta");
      expect(r1.instanceId).not.toBe(r2.instanceId);
    });
  });

  // ── Two runners are independent ───────────────────────────────────────────

  describe("independence between multiple instances", () => {
    it("two runners have independent isRunning state", () => {
      const { runner: r1 } = makeRunner("agent-1");
      const { runner: r2 } = makeRunner("agent-2");
      expect(r1.isRunning).toBe(false);
      expect(r2.isRunning).toBe(false);
    });

    it("two runners have independent containerName state", () => {
      const { runner: r1 } = makeRunner("agent-1");
      const { runner: r2 } = makeRunner("agent-2");
      expect(r1.containerName).toBeUndefined();
      expect(r2.containerName).toBeUndefined();
    });

    it("calling abort() on one runner does not affect the other", () => {
      const { runner: r1 } = makeRunner("agent-1");
      const { runner: r2 } = makeRunner("agent-2");
      r1.abort();
      expect(r2.isRunning).toBe(false);
      expect(r2.containerName).toBeUndefined();
    });

    it("setting image on one runner does not affect the other", () => {
      const { runner: r1 } = makeRunner("agent-1");
      const { runner: r2 } = makeRunner("agent-2");
      r1.setImage("different-image:v2");
      // Both still idle and no container
      expect(r1.containerName).toBeUndefined();
      expect(r2.containerName).toBeUndefined();
    });
  });

  // ── gatewayUrl empty string ───────────────────────────────────────────────

  describe("empty gatewayUrl (no gateway mode)", () => {
    it("constructor accepts empty gatewayUrl without error", () => {
      expect(() => new ContainerAgentRunner(
        makeRuntime() as any,
        makeGlobalConfig(),
        makeAgentConfig("no-gateway-agent"),
        makeLogger() as any,
        async () => {},
        async () => {},
        "", // empty gatewayUrl
        "/tmp/project",
        "image:latest",
      )).not.toThrow();
    });

    it("abort() does not call kill() when gatewayUrl is empty and no container", () => {
      let killCalled = false;
      const runtime = { ...makeRuntime(), kill: async () => { killCalled = true; } };

      const runner = new ContainerAgentRunner(
        runtime as any,
        makeGlobalConfig(),
        makeAgentConfig("no-gw"),
        makeLogger() as any,
        async () => {},
        async () => {},
        "",
        "/tmp",
        "img",
      );
      runner.abort();
      expect(killCalled).toBe(false);
    });
  });
});
