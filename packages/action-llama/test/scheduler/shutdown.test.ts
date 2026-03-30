import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerShutdownHandlers } from "../../src/scheduler/shutdown.js";

describe("registerShutdownHandlers", () => {
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let processOnSpy: ReturnType<typeof vi.spyOn>;
  let originalListeners: Record<string, Function[]>;

  beforeEach(() => {
    // Capture and prevent actual process.exit
    processExitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: any) => {
      return undefined as never;
    });
    // Track registered listeners so we can invoke and clean them up
    originalListeners = {};
    processOnSpy = vi.spyOn(process, "on").mockImplementation((event: string | symbol, listener: (...args: any[]) => void) => {
      const key = String(event);
      if (!originalListeners[key]) originalListeners[key] = [];
      originalListeners[key].push(listener);
      return process;
    });
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    processOnSpy.mockRestore();
  });

  function makeSchedulerCtx() {
    return {
      shuttingDown: false,
      workQueue: {
        clearAll: vi.fn(),
        close: vi.fn(),
      },
    } as any;
  }

  function makeLogger() {
    return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as any;
  }

  it("registers handlers for both SIGINT and SIGTERM", () => {
    const ctx = makeSchedulerCtx();
    registerShutdownHandlers({
      logger: makeLogger(),
      schedulerCtx: ctx,
      cronJobs: [],
      watcherHandle: { stop: vi.fn() },
    });

    expect(originalListeners["SIGINT"]).toHaveLength(1);
    expect(originalListeners["SIGTERM"]).toHaveLength(1);
  });

  it("SIGINT handler stops the watcher and exits", async () => {
    const ctx = makeSchedulerCtx();
    const logger = makeLogger();
    const watcherStop = vi.fn();

    registerShutdownHandlers({
      logger,
      schedulerCtx: ctx,
      cronJobs: [],
      watcherHandle: { stop: watcherStop },
    });

    await originalListeners["SIGINT"][0]();

    expect(watcherStop).toHaveBeenCalledOnce();
    expect(ctx.shuttingDown).toBe(true);
    expect(ctx.workQueue.clearAll).not.toHaveBeenCalled();
    expect(ctx.workQueue.close).toHaveBeenCalledOnce();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it("SIGTERM handler stops the watcher and exits", async () => {
    const ctx = makeSchedulerCtx();
    const watcherStop = vi.fn();

    registerShutdownHandlers({
      logger: makeLogger(),
      schedulerCtx: ctx,
      cronJobs: [],
      watcherHandle: { stop: watcherStop },
    });

    await originalListeners["SIGTERM"][0]();

    expect(watcherStop).toHaveBeenCalledOnce();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it("stops all cron jobs on shutdown", async () => {
    const ctx = makeSchedulerCtx();
    const cronJob1 = { stop: vi.fn() } as any;
    const cronJob2 = { stop: vi.fn() } as any;

    registerShutdownHandlers({
      logger: makeLogger(),
      schedulerCtx: ctx,
      cronJobs: [cronJob1, cronJob2],
      watcherHandle: { stop: vi.fn() },
    });

    await originalListeners["SIGINT"][0]();

    expect(cronJob1.stop).toHaveBeenCalledOnce();
    expect(cronJob2.stop).toHaveBeenCalledOnce();
  });

  it("closes gateway if provided", async () => {
    const ctx = makeSchedulerCtx();
    const logger = makeLogger();
    const gateway = { close: vi.fn().mockResolvedValue(undefined) } as any;

    registerShutdownHandlers({
      logger,
      schedulerCtx: ctx,
      cronJobs: [],
      gateway,
      watcherHandle: { stop: vi.fn() },
    });

    await originalListeners["SIGINT"][0]();

    expect(gateway.close).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith("Gateway server stopped");
  });

  it("does not close gateway if not provided", async () => {
    const ctx = makeSchedulerCtx();

    registerShutdownHandlers({
      logger: makeLogger(),
      schedulerCtx: ctx,
      cronJobs: [],
      watcherHandle: { stop: vi.fn() },
    });

    // Should not throw
    await expect(originalListeners["SIGINT"][0]()).resolves.toBeUndefined();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it("closes stateStore if provided", async () => {
    const ctx = makeSchedulerCtx();
    const stateStore = { close: vi.fn().mockResolvedValue(undefined) } as any;

    registerShutdownHandlers({
      logger: makeLogger(),
      schedulerCtx: ctx,
      cronJobs: [],
      stateStore,
      watcherHandle: { stop: vi.fn() },
    });

    await originalListeners["SIGINT"][0]();

    expect(stateStore.close).toHaveBeenCalledOnce();
  });

  it("closes statsStore if provided", async () => {
    const ctx = makeSchedulerCtx();
    const statsStore = { close: vi.fn() } as any;

    registerShutdownHandlers({
      logger: makeLogger(),
      schedulerCtx: ctx,
      cronJobs: [],
      statsStore,
      watcherHandle: { stop: vi.fn() },
    });

    await originalListeners["SIGINT"][0]();

    expect(statsStore.close).toHaveBeenCalledOnce();
  });

  it("shuts down telemetry if provided", async () => {
    const ctx = makeSchedulerCtx();
    const logger = makeLogger();
    const telemetry = { shutdown: vi.fn().mockResolvedValue(undefined) };

    registerShutdownHandlers({
      logger,
      schedulerCtx: ctx,
      cronJobs: [],
      telemetry,
      watcherHandle: { stop: vi.fn() },
    });

    await originalListeners["SIGINT"][0]();

    expect(telemetry.shutdown).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith("Telemetry shutdown completed");
  });

  it("logs warning when telemetry shutdown throws", async () => {
    const ctx = makeSchedulerCtx();
    const logger = makeLogger();
    const telemetry = { shutdown: vi.fn().mockRejectedValue(new Error("telemetry error")) };

    registerShutdownHandlers({
      logger,
      schedulerCtx: ctx,
      cronJobs: [],
      telemetry,
      watcherHandle: { stop: vi.fn() },
    });

    await originalListeners["SIGINT"][0]();

    expect(logger.warn).toHaveBeenCalledWith(
      { error: "telemetry error" },
      "Error during telemetry shutdown"
    );
    // Process should still exit even when telemetry fails
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it("logs completion message after stopping cron jobs", async () => {
    const ctx = makeSchedulerCtx();
    const logger = makeLogger();

    registerShutdownHandlers({
      logger,
      schedulerCtx: ctx,
      cronJobs: [],
      watcherHandle: { stop: vi.fn() },
    });

    await originalListeners["SIGINT"][0]();

    expect(logger.info).toHaveBeenCalledWith("All cron jobs stopped");
  });

  it("logs initial shutdown message", async () => {
    const ctx = makeSchedulerCtx();
    const logger = makeLogger();

    registerShutdownHandlers({
      logger,
      schedulerCtx: ctx,
      cronJobs: [],
      watcherHandle: { stop: vi.fn() },
    });

    await originalListeners["SIGINT"][0]();

    expect(logger.info).toHaveBeenCalledWith("Shutting down scheduler...");
  });

  it("handles all optional deps absent - graceful minimal shutdown", async () => {
    const ctx = makeSchedulerCtx();
    const logger = makeLogger();

    registerShutdownHandlers({
      logger,
      schedulerCtx: ctx,
      cronJobs: [],
      watcherHandle: { stop: vi.fn() },
      // No gateway, stateStore, statsStore, or telemetry
    });

    await originalListeners["SIGINT"][0]();

    expect(ctx.shuttingDown).toBe(true);
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });
});
