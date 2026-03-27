import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatContainerLauncher } from "../../src/chat/container-launcher.js";
import { ChatSessionManager } from "../../src/chat/session-manager.js";
import type { Runtime, RuntimeCredentials } from "../../src/docker/runtime.js";
import type { AgentConfig, GlobalConfig } from "../../src/shared/config.js";

function createMockRuntime(overrides: Partial<Runtime> = {}): Runtime {
  return {
    needsGateway: false,
    isAgentRunning: vi.fn().mockResolvedValue(false),
    listRunningAgents: vi.fn().mockResolvedValue([]),
    launch: vi.fn().mockResolvedValue("chat-container-abc"),
    streamLogs: vi.fn().mockReturnValue({ stop: vi.fn() }),
    waitForExit: vi.fn().mockResolvedValue(0),
    kill: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    prepareCredentials: vi.fn().mockResolvedValue({
      strategy: "volume",
      stagingDir: "/tmp/creds",
      bundle: {},
    } as RuntimeCredentials),
    buildImage: vi.fn().mockResolvedValue("image:latest"),
    pushImage: vi.fn().mockResolvedValue("image:latest"),
    cleanupCredentials: vi.fn(),
    fetchLogs: vi.fn().mockResolvedValue([]),
    followLogs: vi.fn().mockReturnValue({ stop: vi.fn() }),
    getTaskUrl: vi.fn().mockReturnValue(null),
    ...overrides,
  } as Runtime;
}

const makeMockLogger = (): any => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => makeMockLogger(),
});

const agentConfig: AgentConfig = {
  name: "test-agent",
  credentials: ["github_token"],
  models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
  schedule: "*/5 * * * *",
};

describe("ChatContainerLauncher", () => {
  let runtime: Runtime;
  let sessionManager: ChatSessionManager;
  let launcher: ChatContainerLauncher;
  let registerContainer: ReturnType<typeof vi.fn>;
  let unregisterContainer: ReturnType<typeof vi.fn>;
  const logger = makeMockLogger();

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = createMockRuntime();
    sessionManager = new ChatSessionManager(5);
    registerContainer = vi.fn().mockResolvedValue(undefined);
    unregisterContainer = vi.fn().mockResolvedValue(undefined);
    launcher = new ChatContainerLauncher({
      runtime,
      globalConfig: {} as GlobalConfig,
      agentConfigs: [agentConfig],
      gatewayUrl: "http://localhost:8080",
      logger,
      sessionManager,
      images: new Map([["test-agent", "test-image:latest"]]),
      registerContainer: registerContainer as any,
      unregisterContainer: unregisterContainer as any,
    });
  });

  describe("launchChatContainer", () => {
    it("launches a container with chat env vars", async () => {
      const session = sessionManager.createSession("test-agent");
      const containerName = await launcher.launchChatContainer("test-agent", session.sessionId);

      expect(containerName).toBe("chat-container-abc");
      expect(runtime.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          image: "test-image:latest",
          env: expect.objectContaining({
            AL_CHAT_MODE: "1",
            AL_CHAT_SESSION_ID: session.sessionId,
            GATEWAY_URL: "http://localhost:8080",
          }),
        }),
      );
    });

    it("sets container name on session", async () => {
      const session = sessionManager.createSession("test-agent");
      await launcher.launchChatContainer("test-agent", session.sessionId);
      expect(session.containerName).toBe("chat-container-abc");
    });

    it("prepares credentials for the agent", async () => {
      const session = sessionManager.createSession("test-agent");
      await launcher.launchChatContainer("test-agent", session.sessionId);

      expect(runtime.prepareCredentials).toHaveBeenCalledWith(
        expect.arrayContaining(["github_token", "anthropic_key"]),
      );
    });

    it("calls registerContainer with a shutdown secret", async () => {
      const session = sessionManager.createSession("test-agent");
      await launcher.launchChatContainer("test-agent", session.sessionId);

      expect(registerContainer).toHaveBeenCalledTimes(1);
      const [secret, reg] = registerContainer.mock.calls[0];
      expect(typeof secret).toBe("string");
      expect(secret.length).toBeGreaterThan(0);
      expect(reg).toMatchObject({ agentName: "test-agent" });
    });

    it("stores shutdown secret on the session", async () => {
      const session = sessionManager.createSession("test-agent");
      await launcher.launchChatContainer("test-agent", session.sessionId);

      expect(session.shutdownSecret).toBeTruthy();
    });

    it("passes SHUTDOWN_SECRET in container env vars", async () => {
      const session = sessionManager.createSession("test-agent");
      await launcher.launchChatContainer("test-agent", session.sessionId);

      expect(runtime.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          env: expect.objectContaining({
            SHUTDOWN_SECRET: expect.any(String),
          }),
        }),
      );
    });

    it("throws for unknown agent", async () => {
      await expect(
        launcher.launchChatContainer("nonexistent", "session-1"),
      ).rejects.toThrow('Agent "nonexistent" not found');
    });

    it("throws when no image is available", async () => {
      const noImageLauncher = new ChatContainerLauncher({
        runtime,
        globalConfig: {} as GlobalConfig,
        agentConfigs: [agentConfig],
        gatewayUrl: "http://localhost:8080",
        logger,
        sessionManager,
        images: new Map(),
      });

      const session = sessionManager.createSession("test-agent");
      await expect(
        noImageLauncher.launchChatContainer("test-agent", session.sessionId),
      ).rejects.toThrow("No image available");
    });
  });

  describe("stopChatContainer", () => {
    it("kills and removes the container", async () => {
      const session = sessionManager.createSession("test-agent");
      await launcher.launchChatContainer("test-agent", session.sessionId);

      await launcher.stopChatContainer(session.sessionId);

      expect(runtime.kill).toHaveBeenCalledWith("chat-container-abc");
      expect(runtime.remove).toHaveBeenCalledWith("chat-container-abc");
    });

    it("does nothing for session without container", async () => {
      const session = sessionManager.createSession("test-agent");
      // Don't launch — no containerName set

      await launcher.stopChatContainer(session.sessionId);
      expect(runtime.kill).not.toHaveBeenCalled();
    });

    it("does nothing for unknown session", async () => {
      await launcher.stopChatContainer("nonexistent");
      expect(runtime.kill).not.toHaveBeenCalled();
    });

    it("handles kill errors gracefully", async () => {
      (runtime.kill as any).mockRejectedValueOnce(new Error("container gone"));

      const session = sessionManager.createSession("test-agent");
      await launcher.launchChatContainer("test-agent", session.sessionId);

      // Should not throw
      await launcher.stopChatContainer(session.sessionId);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("calls unregisterContainer with the stored shutdown secret", async () => {
      const session = sessionManager.createSession("test-agent");
      await launcher.launchChatContainer("test-agent", session.sessionId);

      const shutdownSecret = session.shutdownSecret;
      await launcher.stopChatContainer(session.sessionId);

      expect(unregisterContainer).toHaveBeenCalledWith(shutdownSecret);
    });

    it("calls runtime.cleanupCredentials on stop", async () => {
      const session = sessionManager.createSession("test-agent");
      await launcher.launchChatContainer("test-agent", session.sessionId);
      await launcher.stopChatContainer(session.sessionId);

      expect(runtime.cleanupCredentials).toHaveBeenCalled();
    });

    it("does not call unregisterContainer when session has no shutdown secret", async () => {
      const session = sessionManager.createSession("test-agent");
      // Launch without registering (simulated by not setting shutdownSecret)
      registerContainer.mockRejectedValueOnce(new Error("registration failed"));
      await launcher.launchChatContainer("test-agent", session.sessionId);
      unregisterContainer.mockClear();

      await launcher.stopChatContainer(session.sessionId);
      expect(unregisterContainer).not.toHaveBeenCalled();
    });
  });
});
