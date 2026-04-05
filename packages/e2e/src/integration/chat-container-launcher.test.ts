/**
 * Integration tests: chat/container-launcher.ts ChatContainerLauncher — no Docker required.
 *
 * ChatContainerLauncher manages the lifecycle of Docker containers for chat
 * sessions. The error paths in launchChatContainer() can be triggered without
 * Docker by providing configs that reference missing agents or images.
 * The stopChatContainer() method is a no-op for sessions with no container.
 *
 * Test scenarios (no Docker required):
 *   1.  constructor: instantiates without throwing with minimal config
 *   2.  constructor: optional registerContainer/unregisterContainer default to no-ops
 *   3.  launchChatContainer(): throws "not found" for unknown agentName
 *   4.  launchChatContainer(): throws "No image available" when agent exists but no image
 *   5.  stopChatContainer(): no-op when session not found (getSession returns undefined)
 *   6.  stopChatContainer(): no-op when session has no containerName
 *   7.  Two launchers have independent agentConfigs state
 *   8.  launchChatContainer(): error message includes the agent name (not found case)
 *   9.  launchChatContainer(): error message includes the agent name (no image case)
 *  10.  stopChatContainer(): no-op for unknown session IDs (no crash)
 *
 * Covers:
 *   - chat/container-launcher.ts: ChatContainerLauncher constructor
 *   - chat/container-launcher.ts: launchChatContainer() "agent not found" path
 *   - chat/container-launcher.ts: launchChatContainer() "no image available" path
 *   - chat/container-launcher.ts: stopChatContainer() no-op when session missing
 *   - chat/container-launcher.ts: stopChatContainer() no-op when no containerName
 */

import { describe, it, expect } from "vitest";

const { ChatContainerLauncher } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/chat/container-launcher.js"
);

const { ChatSessionManager } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/chat/session-manager.js"
);

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRuntime() {
  return {
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
    buildImage: async () => "image:latest",
    getTaskUrl: () => undefined,
  };
}

function makeLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => makeLogger(),
  };
}

function makeAgentConfig(name: string): any {
  return {
    name,
    models: [],
    credentials: [],
    timeout: 60,
  };
}

function makeGlobalConfig(): any {
  return {
    models: {},
    local: { enabled: true },
  };
}

/**
 * Create a ChatContainerLauncher with a specific set of agents and images.
 */
function makeLauncher(opts: {
  agents?: any[];
  images?: Map<string, string>;
  sessionManager?: InstanceType<typeof ChatSessionManager>;
} = {}) {
  const sessionManager = opts.sessionManager ?? new ChatSessionManager();
  return new ChatContainerLauncher({
    runtime: makeRuntime() as any,
    globalConfig: makeGlobalConfig(),
    agentConfigs: opts.agents ?? [],
    gatewayUrl: "http://localhost:8080",
    logger: makeLogger() as any,
    sessionManager,
    images: opts.images ?? new Map(),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("integration: ChatContainerLauncher (no Docker required)", { timeout: 30_000 }, () => {

  // ── constructor ────────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("instantiates without throwing with minimal config", () => {
      expect(() => makeLauncher()).not.toThrow();
    });

    it("accepts registerContainer and unregisterContainer callbacks", () => {
      const sessionManager = new ChatSessionManager();
      expect(() => new ChatContainerLauncher({
        runtime: makeRuntime() as any,
        globalConfig: makeGlobalConfig(),
        agentConfigs: [],
        gatewayUrl: "",
        logger: makeLogger() as any,
        sessionManager,
        images: new Map(),
        registerContainer: async () => {},
        unregisterContainer: async () => {},
      })).not.toThrow();
    });

    it("works without optional registerContainer/unregisterContainer (they default to no-ops)", () => {
      const sessionManager = new ChatSessionManager();
      expect(() => new ChatContainerLauncher({
        runtime: makeRuntime() as any,
        globalConfig: makeGlobalConfig(),
        agentConfigs: [],
        gatewayUrl: "",
        logger: makeLogger() as any,
        sessionManager,
        images: new Map(),
        // No registerContainer/unregisterContainer provided
      })).not.toThrow();
    });

    it("accepts agentConfigs with multiple agents", () => {
      expect(() => makeLauncher({
        agents: [
          makeAgentConfig("agent-one"),
          makeAgentConfig("agent-two"),
          makeAgentConfig("agent-three"),
        ],
      })).not.toThrow();
    });
  });

  // ── launchChatContainer() — "agent not found" path ────────────────────────

  describe("launchChatContainer() — agent not found", () => {
    it("throws when the agentName is not in agentConfigs", async () => {
      const launcher = makeLauncher({ agents: [] });
      await expect(
        launcher.launchChatContainer("nonexistent-agent", "session-123")
      ).rejects.toThrow();
    });

    it("error message includes the agent name", async () => {
      const launcher = makeLauncher({ agents: [] });
      let caught: Error | undefined;
      try {
        await launcher.launchChatContainer("my-missing-agent", "sess-456");
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toContain("my-missing-agent");
    });

    it("error message mentions 'not found'", async () => {
      const launcher = makeLauncher({ agents: [] });
      let caught: Error | undefined;
      try {
        await launcher.launchChatContainer("agent-xyz", "sess-789");
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toContain("not found");
    });

    it("throws even when other agents exist in agentConfigs", async () => {
      const launcher = makeLauncher({ agents: [makeAgentConfig("existing-agent")] });
      await expect(
        launcher.launchChatContainer("different-agent", "sess-001")
      ).rejects.toThrow();
    });
  });

  // ── launchChatContainer() — "no image available" path ───────────────────

  describe("launchChatContainer() — no image available", () => {
    it("throws when agent exists but has no image in the images map", async () => {
      const launcher = makeLauncher({
        agents: [makeAgentConfig("known-agent")],
        images: new Map(), // empty images map
      });
      await expect(
        launcher.launchChatContainer("known-agent", "session-abc")
      ).rejects.toThrow();
    });

    it("error message includes the agent name", async () => {
      const launcher = makeLauncher({
        agents: [makeAgentConfig("known-agent-no-image")],
        images: new Map(),
      });
      let caught: Error | undefined;
      try {
        await launcher.launchChatContainer("known-agent-no-image", "sess-def");
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toContain("known-agent-no-image");
    });

    it("error message mentions image not available", async () => {
      const launcher = makeLauncher({
        agents: [makeAgentConfig("imageless-agent")],
        images: new Map(),
      });
      let caught: Error | undefined;
      try {
        await launcher.launchChatContainer("imageless-agent", "sess-ghi");
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      // The error should reference something about no image
      expect(caught!.message.toLowerCase()).toContain("image");
    });
  });

  // ── stopChatContainer() — session not found (no-op) ──────────────────────

  describe("stopChatContainer() — session not found", () => {
    it("does not throw when session ID is unknown", async () => {
      const launcher = makeLauncher();
      await expect(
        launcher.stopChatContainer("unknown-session-id")
      ).resolves.toBeUndefined();
    });

    it("returns undefined (void) for unknown session", async () => {
      const launcher = makeLauncher();
      const result = await launcher.stopChatContainer("nonexistent-session");
      expect(result).toBeUndefined();
    });

    it("is safe to call multiple times for the same unknown session", async () => {
      const launcher = makeLauncher();
      await expect(launcher.stopChatContainer("unknown-1")).resolves.not.toThrow();
      await expect(launcher.stopChatContainer("unknown-1")).resolves.not.toThrow();
    });
  });

  // ── stopChatContainer() — session exists but has no containerName ─────────

  describe("stopChatContainer() — session with no containerName", () => {
    it("does not throw when session exists but has no containerName", async () => {
      const sessionManager = new ChatSessionManager();
      const session = sessionManager.createSession("my-agent");
      // session.containerName is undefined (not yet launched)

      const launcher = makeLauncher({ sessionManager });
      await expect(
        launcher.stopChatContainer(session.sessionId)
      ).resolves.toBeUndefined();
    });
  });

  // ── instance independence ─────────────────────────────────────────────────

  describe("instance independence", () => {
    it("two launchers with different agents are independent", async () => {
      const launcher1 = makeLauncher({ agents: [makeAgentConfig("agent-a")] });
      const launcher2 = makeLauncher({ agents: [makeAgentConfig("agent-b")] });

      // launcher1 knows "agent-a" but not "agent-b"
      let caught1: Error | undefined;
      try {
        await launcher1.launchChatContainer("agent-b", "sess-x");
      } catch (e) {
        caught1 = e as Error;
      }
      expect(caught1).toBeDefined();
      expect(caught1!.message).toContain("agent-b");

      // launcher2 knows "agent-b" but not "agent-a"
      let caught2: Error | undefined;
      try {
        await launcher2.launchChatContainer("agent-a", "sess-y");
      } catch (e) {
        caught2 = e as Error;
      }
      expect(caught2).toBeDefined();
      expect(caught2!.message).toContain("agent-a");
    });
  });
});
