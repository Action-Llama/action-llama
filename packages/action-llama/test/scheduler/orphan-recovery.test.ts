import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock drainQueues from execution module
const mockDrainQueues = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/execution/execution.js", () => ({
  drainQueues: (...args: any[]) => mockDrainQueues(...args),
}));

import { recoverOrphanContainers } from "../../src/scheduler/orphan-recovery.js";
import type { OrphanRecoveryOpts } from "../../src/scheduler/orphan-recovery.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  } as any;
}

function makeRuntime(overrides: Partial<ReturnType<typeof makeRuntime>> = {}) {
  return {
    listRunningAgents: vi.fn().mockResolvedValue([]),
    kill: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    inspectContainer: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as any;
}

function makeContainerRegistry(overrides: Partial<ReturnType<typeof makeContainerRegistry>> = {}) {
  return {
    listAll: vi.fn().mockReturnValue([]),
    findByContainerName: vi.fn().mockReturnValue(undefined),
    unregister: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

function makeLockStore() {
  return {
    releaseAll: vi.fn().mockReturnValue(0),
  } as any;
}

function makeGateway(containerRegistry?: any, lockStore?: any) {
  return {
    containerRegistry: containerRegistry ?? makeContainerRegistry(),
    lockStore: lockStore ?? makeLockStore(),
  } as any;
}

function makeRunnerPool(runner?: any) {
  return {
    getAvailableRunner: vi.fn().mockReturnValue(runner ?? null),
  } as any;
}

function makeContainerRunner(adoptContainer?: any) {
  return {
    adoptContainer: adoptContainer ?? vi.fn().mockResolvedValue(undefined),
  };
}

describe("recoverOrphanContainers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when no orphan containers are running", async () => {
    const runtime = makeRuntime({ listRunningAgents: vi.fn().mockResolvedValue([]) });
    const containerRegistry = makeContainerRegistry({ listAll: vi.fn().mockReturnValue([]) });
    const gateway = makeGateway(containerRegistry);
    const logger = makeLogger();

    await recoverOrphanContainers({
      runtime, gateway, runnerPools: {}, activeAgentConfigs: [],
      schedulerState: { schedulerCtx: null }, logger,
    });

    expect(runtime.kill).not.toHaveBeenCalled();
    expect(containerRegistry.clear).not.toHaveBeenCalled();
  });

  it("clears all stale registry entries when no containers are running but registry has entries", async () => {
    const runtime = makeRuntime({ listRunningAgents: vi.fn().mockResolvedValue([]) });
    const staleEntries = [
      { containerName: "c1", agentName: "agent-a", instanceId: "agent-a-1" },
      { containerName: "c2", agentName: "agent-b", instanceId: "agent-b-1" },
    ];
    const lockStore = makeLockStore();
    const containerRegistry = makeContainerRegistry({ listAll: vi.fn().mockReturnValue(staleEntries) });
    const gateway = makeGateway(containerRegistry, lockStore);
    const logger = makeLogger();

    await recoverOrphanContainers({
      runtime, gateway, runnerPools: {},
      activeAgentConfigs: [{ name: "agent-a" }, { name: "agent-b" }] as any,
      schedulerState: { schedulerCtx: null }, logger,
    });

    expect(lockStore.releaseAll).toHaveBeenCalledTimes(2);
    expect(containerRegistry.clear).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ releasedLocks: 0, staleRegistrations: 2 }),
      "cleaned up stale registrations (no running containers)"
    );
  });

  it("kills unregistered orphan containers", async () => {
    const orphan = { taskId: "container-123", agentName: "agent-a" };
    const runtime = makeRuntime({ listRunningAgents: vi.fn().mockResolvedValue([orphan]) });
    const containerRegistry = makeContainerRegistry({
      listAll: vi.fn().mockReturnValue([]),
      findByContainerName: vi.fn().mockReturnValue(undefined), // not registered
    });
    const gateway = makeGateway(containerRegistry);
    const logger = makeLogger();

    await recoverOrphanContainers({
      runtime, gateway, runnerPools: {},
      activeAgentConfigs: [{ name: "agent-a" }] as any,
      schedulerState: { schedulerCtx: null }, logger,
    });

    expect(runtime.kill).toHaveBeenCalledWith("container-123");
    expect(runtime.remove).toHaveBeenCalledWith("container-123");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-a", task: "container-123" }),
      "killing unregistered orphan container"
    );
  });

  it("kills orphans whose agent has no runner pool", async () => {
    const orphan = { taskId: "container-123", agentName: "agent-a" };
    const reg = { containerName: "container-123", agentName: "agent-a", instanceId: "agent-a-1" };
    const lockStore = makeLockStore();
    const containerRegistry = makeContainerRegistry({
      listAll: vi.fn().mockReturnValue([reg]),
      findByContainerName: vi.fn().mockReturnValue({ secret: "old-secret", reg }),
    });
    const runtime = makeRuntime({ listRunningAgents: vi.fn().mockResolvedValue([orphan]) });
    const gateway = makeGateway(containerRegistry, lockStore);
    const logger = makeLogger();

    await recoverOrphanContainers({
      runtime, gateway,
      runnerPools: {}, // no pool for agent-a
      activeAgentConfigs: [{ name: "agent-a" }] as any,
      schedulerState: { schedulerCtx: null }, logger,
    });

    expect(runtime.kill).toHaveBeenCalledWith("container-123");
    expect(lockStore.releaseAll).toHaveBeenCalledWith("agent-a-1");
    expect(containerRegistry.unregister).toHaveBeenCalledWith("old-secret");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-a", task: "container-123" }),
      "no runner pool for orphan, killing"
    );
  });

  it("kills orphans when SHUTDOWN_SECRET cannot be read", async () => {
    const orphan = { taskId: "container-123", agentName: "agent-a" };
    const reg = { containerName: "container-123", agentName: "agent-a", instanceId: "agent-a-1" };
    const lockStore = makeLockStore();
    const containerRegistry = makeContainerRegistry({
      listAll: vi.fn().mockReturnValue([reg]),
      findByContainerName: vi.fn().mockReturnValue({ secret: "old-secret", reg }),
    });
    const runtime = makeRuntime({
      listRunningAgents: vi.fn().mockResolvedValue([orphan]),
      inspectContainer: vi.fn().mockResolvedValue({ env: {} }), // no SHUTDOWN_SECRET
    });
    const pool = makeRunnerPool(); // pool exists
    const gateway = makeGateway(containerRegistry, lockStore);
    const logger = makeLogger();

    await recoverOrphanContainers({
      runtime, gateway,
      runnerPools: { "agent-a": pool },
      activeAgentConfigs: [{ name: "agent-a" }] as any,
      schedulerState: { schedulerCtx: null }, logger,
    });

    expect(runtime.kill).toHaveBeenCalledWith("container-123");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-a", task: "container-123" }),
      "cannot read SHUTDOWN_SECRET from orphan, killing"
    );
  });

  it("kills orphans when no available runner", async () => {
    const orphan = { taskId: "container-123", agentName: "agent-a" };
    const reg = { containerName: "container-123", agentName: "agent-a", instanceId: "agent-a-1" };
    const lockStore = makeLockStore();
    const containerRegistry = makeContainerRegistry({
      listAll: vi.fn().mockReturnValue([reg]),
      findByContainerName: vi.fn().mockReturnValue({ secret: "old-secret", reg }),
    });
    const runtime = makeRuntime({
      listRunningAgents: vi.fn().mockResolvedValue([orphan]),
      inspectContainer: vi.fn().mockResolvedValue({ env: { SHUTDOWN_SECRET: "my-secret" } }),
    });
    const pool = makeRunnerPool(null); // no available runner
    const gateway = makeGateway(containerRegistry, lockStore);
    const logger = makeLogger();

    await recoverOrphanContainers({
      runtime, gateway,
      runnerPools: { "agent-a": pool },
      activeAgentConfigs: [{ name: "agent-a" }] as any,
      schedulerState: { schedulerCtx: null }, logger,
    });

    expect(runtime.kill).toHaveBeenCalledWith("container-123");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-a", task: "container-123" }),
      "no available runner for orphan, killing"
    );
  });

  it("successfully re-adopts an orphan container", async () => {
    const orphan = { taskId: "container-123", agentName: "agent-a" };
    const reg = { containerName: "container-123", agentName: "agent-a", instanceId: "agent-a-1" };
    const lockStore = makeLockStore();
    const containerRegistry = makeContainerRegistry({
      listAll: vi.fn().mockReturnValue([reg]),
      findByContainerName: vi.fn().mockReturnValue({ secret: "old-secret", reg }),
    });
    const runtime = makeRuntime({
      listRunningAgents: vi.fn().mockResolvedValue([orphan]),
      inspectContainer: vi.fn().mockResolvedValue({ env: { SHUTDOWN_SECRET: "my-secret" } }),
    });
    const mockAdoptContainer = vi.fn().mockResolvedValue(undefined);
    const containerRunner = makeContainerRunner(mockAdoptContainer);
    const pool = makeRunnerPool(containerRunner);
    const gateway = makeGateway(containerRegistry, lockStore);
    const logger = makeLogger();

    await recoverOrphanContainers({
      runtime, gateway,
      runnerPools: { "agent-a": pool },
      activeAgentConfigs: [{ name: "agent-a" }] as any,
      schedulerState: { schedulerCtx: null }, logger,
    });

    expect(containerRegistry.unregister).toHaveBeenCalledWith("old-secret");
    expect(mockAdoptContainer).toHaveBeenCalledWith(
      "container-123", "my-secret", "agent-a-1",
      { type: "schedule", source: "re-adopted" }
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-a", task: "container-123", instance: "agent-a-1" }),
      "re-adopting orphan container"
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ adopted: 1, killed: 0, total: 1 }),
      "orphan container handling complete"
    );
  });

  it("kills orphan when reattach fails", async () => {
    const orphan = { taskId: "container-123", agentName: "agent-a" };
    const reg = { containerName: "container-123", agentName: "agent-a", instanceId: "agent-a-1" };
    const lockStore = makeLockStore();
    const containerRegistry = makeContainerRegistry({
      listAll: vi.fn().mockReturnValue([reg]),
      findByContainerName: vi.fn().mockReturnValue({ secret: "old-secret", reg }),
    });
    const runtime = makeRuntime({
      listRunningAgents: vi.fn().mockResolvedValue([orphan]),
      inspectContainer: vi.fn().mockResolvedValue({ env: { SHUTDOWN_SECRET: "my-secret" } }),
      reattach: vi.fn().mockReturnValue(false), // reattach fails
    });
    const containerRunner = makeContainerRunner();
    const pool = makeRunnerPool(containerRunner);
    const gateway = makeGateway(containerRegistry, lockStore);
    const logger = makeLogger();

    await recoverOrphanContainers({
      runtime, gateway,
      runnerPools: { "agent-a": pool },
      activeAgentConfigs: [{ name: "agent-a" }] as any,
      schedulerState: { schedulerCtx: null }, logger,
    });

    expect(runtime.kill).toHaveBeenCalledWith("container-123");
    expect(containerRegistry.unregister).toHaveBeenCalledWith("old-secret");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-a", task: "container-123" }),
      "failed to reattach orphan, killing"
    );
  });

  it("kills orphan when runner does not support adoptContainer", async () => {
    const orphan = { taskId: "container-123", agentName: "agent-a" };
    const reg = { containerName: "container-123", agentName: "agent-a", instanceId: "agent-a-1" };
    const lockStore = makeLockStore();
    const containerRegistry = makeContainerRegistry({
      listAll: vi.fn().mockReturnValue([reg]),
      findByContainerName: vi.fn().mockReturnValue({ secret: "old-secret", reg }),
    });
    const runtime = makeRuntime({
      listRunningAgents: vi.fn().mockResolvedValue([orphan]),
      inspectContainer: vi.fn().mockResolvedValue({ env: { SHUTDOWN_SECRET: "my-secret" } }),
    });
    const plainRunner = {}; // no adoptContainer method
    const pool = makeRunnerPool(plainRunner);
    const gateway = makeGateway(containerRegistry, lockStore);
    const logger = makeLogger();

    await recoverOrphanContainers({
      runtime, gateway,
      runnerPools: { "agent-a": pool },
      activeAgentConfigs: [{ name: "agent-a" }] as any,
      schedulerState: { schedulerCtx: null }, logger,
    });

    expect(runtime.kill).toHaveBeenCalledWith("container-123");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-a" }),
      "runner does not support adoption, killing orphan"
    );
  });

  it("cleans up stale registry entries for containers that exited while scheduler was down", async () => {
    // Two running orphans, but registry also has a stale entry for an exited container
    const orphan = { taskId: "container-running", agentName: "agent-a" };
    const runningReg = { containerName: "container-running", agentName: "agent-a", instanceId: "agent-a-1" };
    const staleReg = { containerName: "container-exited", agentName: "agent-a", instanceId: "agent-a-2" };
    const lockStore = makeLockStore();
    const containerRegistry = makeContainerRegistry({
      // listAll returns both registered containers
      listAll: vi.fn().mockReturnValue([runningReg, staleReg]),
      findByContainerName: vi.fn().mockImplementation((name) => {
        if (name === "container-running") return { secret: "secret-running", reg: runningReg };
        if (name === "container-exited") return { secret: "secret-stale", reg: staleReg };
        return undefined;
      }),
    });
    const runtime = makeRuntime({
      listRunningAgents: vi.fn().mockResolvedValue([orphan]),
      inspectContainer: vi.fn().mockResolvedValue(null), // no SHUTDOWN_SECRET
    });
    const pool = makeRunnerPool(); // no available runner — orphan will be killed
    const gateway = makeGateway(containerRegistry, lockStore);
    const logger = makeLogger();

    await recoverOrphanContainers({
      runtime, gateway,
      runnerPools: { "agent-a": pool },
      activeAgentConfigs: [{ name: "agent-a" }] as any,
      schedulerState: { schedulerCtx: null }, logger,
    });

    // Stale registry entry for the exited container should be cleaned up
    expect(lockStore.releaseAll).toHaveBeenCalledWith("agent-a-2");
    expect(containerRegistry.unregister).toHaveBeenCalledWith("secret-stale");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-a", instance: "agent-a-2" }),
      "cleaned up stale registration (container exited while scheduler was down)"
    );
  });

  it("skips orphan recovery gracefully when listRunningAgents throws", async () => {
    const runtime = makeRuntime({
      listRunningAgents: vi.fn().mockRejectedValue(new Error("runtime does not support listing")),
    });
    const gateway = makeGateway();
    const logger = makeLogger();

    await expect(recoverOrphanContainers({
      runtime, gateway, runnerPools: {},
      activeAgentConfigs: [],
      schedulerState: { schedulerCtx: null }, logger,
    })).resolves.not.toThrow();

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "orphan detection/re-adoption skipped (runtime does not support listing)"
    );
  });

  it("ignores containers not belonging to current agent set", async () => {
    // Runtime has a container for "other-agent" not in activeAgentConfigs
    const orphan = { taskId: "container-other", agentName: "other-agent" };
    const runtime = makeRuntime({ listRunningAgents: vi.fn().mockResolvedValue([orphan]) });
    const containerRegistry = makeContainerRegistry({ listAll: vi.fn().mockReturnValue([]) });
    const gateway = makeGateway(containerRegistry);
    const logger = makeLogger();

    await recoverOrphanContainers({
      runtime, gateway, runnerPools: {},
      activeAgentConfigs: [{ name: "my-agent" }] as any, // "other-agent" not included
      schedulerState: { schedulerCtx: null }, logger,
    });

    // Filtered out — no kills, no registry operations
    expect(runtime.kill).not.toHaveBeenCalled();
    expect(containerRegistry.unregister).not.toHaveBeenCalled();
  });
});
