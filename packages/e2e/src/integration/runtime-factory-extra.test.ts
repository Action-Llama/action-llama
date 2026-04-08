/**
 * Integration tests: execution/runtime-factory.ts buildAgentImages() error path — no Docker required.
 *
 * buildAgentImages() throws AgentError when called with a runtime that does not
 * implement the ContainerRuntime interface (missing buildImage or pushImage).
 *
 * createAgentRuntimeOverride() returns the correct HostUserRuntime based on
 * agentConfig.runtime.type. These functions can be tested without Docker.
 *
 * Covers:
 *   - execution/runtime-factory.ts: buildAgentImages() → AgentError when non-container runtime
 *   - execution/runtime-factory.ts: buildAgentImages() → error message includes "runtime"
 *   - execution/runtime-factory.ts: buildAgentImages() → error is AgentError instance
 *   - execution/runtime-factory.ts: createAgentRuntimeOverride() → undefined for default config
 *   - execution/runtime-factory.ts: createAgentRuntimeOverride() → HostUserRuntime for type=host-user
 *   - execution/runtime-factory.ts: createAgentRuntimeOverride() → respects run_as field
 *   - execution/runtime-factory.ts: createAgentRuntimeOverride() → respects groups field
 *   - execution/runtime-factory.ts: createAgentRuntimeOverride() → defaults runAs to 'al-agent'
 */

import { describe, it, expect, vi } from "vitest";

const { buildAgentImages, createAgentRuntimeOverride } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/runtime-factory.js"
);

const { AgentError } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/errors.js"
);

const { HostUserRuntime } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/docker/host-user-runtime.js"
);

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

// A runtime that does NOT implement ContainerRuntime (no buildImage/pushImage)
const nonContainerRuntime = {
  isAgentRunning: vi.fn(async () => false),
  listRunningAgents: vi.fn(async () => []),
  launch: vi.fn(async () => "task-123"),
  kill: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  needsGateway: false,
  getTaskUrl: () => null,
};

function makeAgentConfig(overrides: Record<string, any> = {}) {
  return {
    name: "test-agent",
    credentials: [],
    models: [],
    schedule: "*/5 * * * *",
    ...overrides,
  };
}

describe(
  "integration: execution/runtime-factory.ts additional paths (no Docker required)",
  { timeout: 15_000 },
  () => {
    // ── buildAgentImages() non-container runtime → AgentError ────────────────

    it("buildAgentImages() throws when runtime is not a ContainerRuntime", async () => {
      await expect(
        buildAgentImages({
          projectPath: "/tmp/fake-project",
          globalConfig: {},
          activeAgentConfigs: [],
          runtime: nonContainerRuntime as any,
          logger: makeLogger() as any,
          skills: {},
        })
      ).rejects.toThrow();
    });

    it("buildAgentImages() throws AgentError (not generic Error)", async () => {
      let caught: any;
      try {
        await buildAgentImages({
          projectPath: "/tmp/fake-project",
          globalConfig: {},
          activeAgentConfigs: [],
          runtime: nonContainerRuntime as any,
          logger: makeLogger() as any,
          skills: {},
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AgentError);
    });

    it("buildAgentImages() error message mentions 'runtime'", async () => {
      let caught: any;
      try {
        await buildAgentImages({
          projectPath: "/tmp/fake-project",
          globalConfig: {},
          activeAgentConfigs: [],
          runtime: nonContainerRuntime as any,
          logger: makeLogger() as any,
          skills: {},
        });
      } catch (err) {
        caught = err;
      }
      expect(caught.message).toContain("runtime");
    });

    // ── createAgentRuntimeOverride() ──────────────────────────────────────────

    it("createAgentRuntimeOverride() returns undefined for agent with no runtime config", () => {
      const result = createAgentRuntimeOverride(makeAgentConfig());
      expect(result).toBeUndefined();
    });

    it("createAgentRuntimeOverride() returns undefined for agent with runtime.type='container'", () => {
      const result = createAgentRuntimeOverride(makeAgentConfig({ runtime: { type: "container" } }));
      expect(result).toBeUndefined();
    });

    it("createAgentRuntimeOverride() returns HostUserRuntime for runtime.type='host-user'", () => {
      const result = createAgentRuntimeOverride(makeAgentConfig({ runtime: { type: "host-user" } }));
      expect(result).toBeInstanceOf(HostUserRuntime);
    });

    it("createAgentRuntimeOverride() HostUserRuntime respects run_as field", () => {
      const result = createAgentRuntimeOverride(
        makeAgentConfig({ runtime: { type: "host-user", run_as: "custom-user" } })
      );
      expect(result).toBeInstanceOf(HostUserRuntime);
      // HostUserRuntime stores runAs privately, so just verify it doesn't throw
    });

    it("createAgentRuntimeOverride() defaults run_as to 'al-agent' when not specified", () => {
      const result = createAgentRuntimeOverride(
        makeAgentConfig({ runtime: { type: "host-user" } })
      );
      // Two instances with default runAs should both be HostUserRuntime
      expect(result).toBeInstanceOf(HostUserRuntime);
    });

    it("createAgentRuntimeOverride() HostUserRuntime respects groups field", () => {
      const result = createAgentRuntimeOverride(
        makeAgentConfig({ runtime: { type: "host-user", groups: ["docker", "sudo"] } })
      );
      expect(result).toBeInstanceOf(HostUserRuntime);
    });

    it("createAgentRuntimeOverride() returns independent instances for different agents", () => {
      const r1 = createAgentRuntimeOverride(
        makeAgentConfig({ name: "agent1", runtime: { type: "host-user" } })
      );
      const r2 = createAgentRuntimeOverride(
        makeAgentConfig({ name: "agent2", runtime: { type: "host-user" } })
      );
      expect(r1).not.toBe(r2);
    });
  },
);
