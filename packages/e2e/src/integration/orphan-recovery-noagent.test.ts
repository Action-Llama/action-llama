/**
 * Integration tests: scheduler/orphan-recovery.ts recoverOrphanContainers() — no Docker required.
 *
 * recoverOrphanContainers() handles several scenarios on scheduler startup:
 *   1. No running containers + no stale registry entries → no-op
 *   2. No running containers + stale registry entries → purge stale entries,
 *      release held locks
 *   3. listRunningAgents() throws → silently caught, function returns normally
 *      (debug log emitted)
 *   4. Running container belongs to unknown agent (not in ownAgentNames) →
 *      filtered out, not processed
 *
 * These branches can be exercised without Docker by mocking the runtime and
 * constructing ContainerRegistry / LockStore in-memory.
 *
 * Covers:
 *   - scheduler/orphan-recovery.ts: recoverOrphanContainers() — no orphans + no stale entries → no-op
 *   - scheduler/orphan-recovery.ts: recoverOrphanContainers() — stale registry entries cleaned when no running containers
 *   - scheduler/orphan-recovery.ts: recoverOrphanContainers() — locks released for stale registry entries
 *   - scheduler/orphan-recovery.ts: recoverOrphanContainers() — runtime.listRunningAgents() throws → logged and returns
 *   - scheduler/orphan-recovery.ts: recoverOrphanContainers() — running containers for unknown agents are filtered
 */

import { describe, it, expect, vi } from "vitest";

const { recoverOrphanContainers } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/scheduler/orphan-recovery.js"
);

const { ContainerRegistry } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/container-registry.js"
);

const { LockStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/lock-store.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
}

function makeRuntime(overrides: Record<string, any> = {}) {
  return {
    listRunningAgents: vi.fn(async () => []),
    kill: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    inspectContainer: vi.fn(async () => null),
    ...overrides,
  };
}

async function makeGateway(opts: { withStaleEntry?: boolean } = {}) {
  const containerRegistry = new ContainerRegistry(); // no StateStore → in-memory
  const lockStore = new LockStore(undefined, undefined, undefined, {
    isHolderAlive: (instanceId: string) => containerRegistry.hasInstance(instanceId),
  });
  await lockStore.init();

  if (opts.withStaleEntry) {
    // Register a stale container (no corresponding running process)
    await containerRegistry.register("stale-secret-123", {
      containerName: "stale-container",
      agentName: "stale-agent",
      instanceId: "stale-instance-001",
    });
  }

  return {
    containerRegistry,
    lockStore,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("integration: recoverOrphanContainers() — no Docker required", { timeout: 15_000 }, () => {
  it("does nothing when no running containers and no stale registry entries", async () => {
    const runtime = makeRuntime();
    const { containerRegistry, lockStore } = await makeGateway();
    const logger = makeLogger();

    await recoverOrphanContainers({
      runtime,
      gateway: { containerRegistry, lockStore },
      runnerPools: {},
      activeAgentConfigs: [],
      schedulerState: { schedulerCtx: null },
      logger,
    });

    // listRunningAgents was called
    expect(runtime.listRunningAgents).toHaveBeenCalledOnce();
    // No warnings or errors
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    // Registry still empty
    expect(containerRegistry.listAll()).toHaveLength(0);
  });

  it("purges stale registry entries when no running containers are found", async () => {
    const runtime = makeRuntime(); // returns []
    const { containerRegistry, lockStore } = await makeGateway({ withStaleEntry: true });
    const logger = makeLogger();

    // Verify the stale entry is in the registry
    expect(containerRegistry.listAll()).toHaveLength(1);

    await recoverOrphanContainers({
      runtime,
      gateway: { containerRegistry, lockStore },
      runnerPools: {},
      activeAgentConfigs: [{ name: "stale-agent" } as any],
      schedulerState: { schedulerCtx: null },
      logger,
    });

    // Registry should be cleared
    expect(containerRegistry.listAll()).toHaveLength(0);
    // An info log about cleanup should appear
    const infoArgs = logger.info.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(infoArgs).toMatch(/stale/i);
  });

  it("releases held locks for stale registry entries on cleanup", async () => {
    const runtime = makeRuntime(); // returns []
    const { containerRegistry, lockStore } = await makeGateway({ withStaleEntry: true });
    const logger = makeLogger();

    // Manually acquire a lock held by the stale instance
    await lockStore.init();
    lockStore.acquire("stale-instance-001", "github://test/repo");

    await recoverOrphanContainers({
      runtime,
      gateway: { containerRegistry, lockStore },
      runnerPools: {},
      activeAgentConfigs: [{ name: "stale-agent" } as any],
      schedulerState: { schedulerCtx: null },
      logger,
    });

    // After cleanup, the lock should no longer be listed
    const locks = lockStore.list();
    const orphanLocks = locks.filter((l: any) => l.holder === "stale-instance-001");
    expect(orphanLocks).toHaveLength(0);
  });

  it("handles runtime.listRunningAgents() throwing without crashing", async () => {
    const runtime = makeRuntime({
      listRunningAgents: vi.fn(async () => {
        throw new Error("Docker daemon not available");
      }),
    });
    const { containerRegistry, lockStore } = await makeGateway();
    const logger = makeLogger();

    // Should not throw
    await expect(
      recoverOrphanContainers({
        runtime,
        gateway: { containerRegistry, lockStore },
        runnerPools: {},
        activeAgentConfigs: [],
        schedulerState: { schedulerCtx: null },
        logger,
      })
    ).resolves.toBeUndefined();

    // Debug log should be emitted
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringMatching(/orphan.*skip/i),
    );
  });

  it("filters out running containers that belong to unknown agents", async () => {
    const runtime = makeRuntime({
      listRunningAgents: vi.fn(async () => [
        { agentName: "unknown-agent-xyz", taskId: "container-abc" },
      ]),
    });
    const { containerRegistry, lockStore } = await makeGateway();
    const logger = makeLogger();

    // Only "known-agent" is in activeAgentConfigs — "unknown-agent-xyz" is not
    await recoverOrphanContainers({
      runtime,
      gateway: { containerRegistry, lockStore },
      runnerPools: {},
      activeAgentConfigs: [{ name: "known-agent" } as any],
      schedulerState: { schedulerCtx: null },
      logger,
    });

    // The unknown agent's container should not be killed (filtered out)
    expect(runtime.kill).not.toHaveBeenCalled();
    expect(runtime.remove).not.toHaveBeenCalled();
  });

  it("multiple stale entries are all cleaned up", async () => {
    const runtime = makeRuntime(); // returns []
    const { containerRegistry, lockStore } = await makeGateway();
    const logger = makeLogger();

    // Register multiple stale entries
    await containerRegistry.register("stale-secret-A", {
      containerName: "stale-container-A",
      agentName: "agent-alpha",
      instanceId: "inst-alpha-001",
    });
    await containerRegistry.register("stale-secret-B", {
      containerName: "stale-container-B",
      agentName: "agent-beta",
      instanceId: "inst-beta-001",
    });

    expect(containerRegistry.listAll()).toHaveLength(2);

    await recoverOrphanContainers({
      runtime,
      gateway: { containerRegistry, lockStore },
      runnerPools: {},
      activeAgentConfigs: [
        { name: "agent-alpha" } as any,
        { name: "agent-beta" } as any,
      ],
      schedulerState: { schedulerCtx: null },
      logger,
    });

    // All stale entries cleared
    expect(containerRegistry.listAll()).toHaveLength(0);
  });
});
