/**
 * Integration tests: scheduler/shutdown.ts registerShutdownHandlers() — no Docker required.
 *
 * registerShutdownHandlers() sets up SIGINT/SIGTERM process listeners that
 * perform graceful shutdown. The inner shutdown() function:
 *   1. Stops the watcher
 *   2. Marks scheduler as shutting down
 *   3. Closes the work queue
 *   4. Stops all cron jobs
 *   5. Closes the gateway (if present)
 *   6. Closes the state store (if present)
 *   7. Closes the stats store (if present)
 *   8. Closes the shared DB connection (if present)
 *   9. Shuts down telemetry (if present)
 *  10. Calls runtime.shutdown() (if present)
 *  11. Calls process.exit(0)
 *
 * Tests:
 *   - SIGINT handler is registered after calling registerShutdownHandlers()
 *   - SIGTERM handler is registered after calling registerShutdownHandlers()
 *   - shutdown() calls watcherHandle.stop()
 *   - shutdown() sets schedulerCtx.shuttingDown = true
 *   - shutdown() calls workQueue.close()
 *   - shutdown() calls job.stop() on each cron job
 *   - shutdown() calls gateway.close() when gateway is present
 *   - shutdown() skips gateway.close() when gateway is undefined
 *   - shutdown() calls stateStore.close() when present
 *   - shutdown() skips stateStore.close() when undefined
 *   - shutdown() calls statsStore.close() when present
 *   - shutdown() calls sharedDb.$client.close() when present
 *   - shutdown() sharedDb.$client.close() throws → caught silently
 *   - shutdown() calls telemetry.shutdown() when present
 *   - shutdown() telemetry.shutdown() throws → logged warn, does not crash
 *   - shutdown() calls runtime.shutdown() when present and has method
 *   - shutdown() skips runtime.shutdown() when runtime has no shutdown method
 *   - shutdown() calls process.exit(0) at end
 *
 * Covers:
 *   - scheduler/shutdown.ts: registerShutdownHandlers() — SIGINT/SIGTERM registration
 *   - scheduler/shutdown.ts: shutdown() — all conditional branches
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const { registerShutdownHandlers } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/scheduler/shutdown.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

function makeSchedulerCtx(runnerPools = {}) {
  return {
    runnerPools,
    agentConfigs: [],
    maxReruns: 10,
    maxTriggerDepth: 3,
    logger: makeLogger(),
    workQueue: { close: vi.fn() },
    shuttingDown: false,
    useBakedImages: false,
  } as any;
}

function makeCronJob() {
  return { stop: vi.fn() };
}

function makeWatcherHandle() {
  return { stop: vi.fn(), _waitForPending: vi.fn(async () => {}), _handleAgentChange: vi.fn(async () => {}) };
}

function makeGateway() {
  return { close: vi.fn(async () => {}) };
}

function makeStateStore() {
  return { close: vi.fn(async () => {}) };
}

function makeStatsStore() {
  return { close: vi.fn() };
}

function makeSharedDb() {
  return { $client: { close: vi.fn() } };
}

function makeTelemetry(throws = false) {
  return {
    shutdown: vi.fn(async () => {
      if (throws) throw new Error("telemetry shutdown failed");
    }),
  };
}

function makeRuntime(hasShutdown = true, shutdownThrows = false) {
  if (!hasShutdown) {
    return {} as any;
  }
  return {
    shutdown: vi.fn(async () => {
      if (shutdownThrows) throw new Error("runtime shutdown failed");
    }),
  };
}

// ── Test Setup ─────────────────────────────────────────────────────────────

describe(
  "integration: scheduler/shutdown.ts registerShutdownHandlers() — no Docker required",
  { timeout: 10_000 },
  () => {
    let processExitSpy: any;
    let processOnSpy: any;
    const registeredListeners: Record<string, Function[]> = {};

    beforeEach(() => {
      // Mock process.exit to prevent the test process from actually exiting
      processExitSpy = vi.spyOn(process, "exit").mockImplementation((code?: any) => {
        // no-op
      });

      // Spy on process.on to capture registered listeners
      const originalOn = process.on.bind(process);
      processOnSpy = vi.spyOn(process, "on").mockImplementation((event: string, listener: any) => {
        if (!registeredListeners[event]) {
          registeredListeners[event] = [];
        }
        registeredListeners[event].push(listener);
        return process;
      });
    });

    afterEach(() => {
      processExitSpy.mockRestore();
      processOnSpy.mockRestore();
      // Clear the listeners
      for (const key of Object.keys(registeredListeners)) {
        delete registeredListeners[key];
      }
    });

    // ── Registration tests ─────────────────────────────────────────────────

    it("registers a SIGINT handler after calling registerShutdownHandlers()", () => {
      const ctx = makeSchedulerCtx();
      registerShutdownHandlers({
        logger: makeLogger(),
        schedulerCtx: ctx,
        cronJobs: [],
        watcherHandle: makeWatcherHandle(),
      });

      expect(processOnSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    });

    it("registers a SIGTERM handler after calling registerShutdownHandlers()", () => {
      const ctx = makeSchedulerCtx();
      registerShutdownHandlers({
        logger: makeLogger(),
        schedulerCtx: ctx,
        cronJobs: [],
        watcherHandle: makeWatcherHandle(),
      });

      expect(processOnSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    });

    // ── Shutdown function tests (via SIGINT listener) ──────────────────────

    async function callShutdown(deps: any): Promise<void> {
      registerShutdownHandlers(deps);
      // Get the SIGINT handler and call it directly
      const sigintListeners = registeredListeners["SIGINT"];
      expect(sigintListeners).toBeDefined();
      const handler = sigintListeners![sigintListeners!.length - 1];
      await handler();
    }

    it("shutdown() calls watcherHandle.stop()", async () => {
      const watcherHandle = makeWatcherHandle();
      const ctx = makeSchedulerCtx();
      await callShutdown({
        logger: makeLogger(),
        schedulerCtx: ctx,
        cronJobs: [],
        watcherHandle,
      });
      expect(watcherHandle.stop).toHaveBeenCalledOnce();
    });

    it("shutdown() sets schedulerCtx.shuttingDown = true", async () => {
      const ctx = makeSchedulerCtx();
      expect(ctx.shuttingDown).toBe(false);
      await callShutdown({
        logger: makeLogger(),
        schedulerCtx: ctx,
        cronJobs: [],
        watcherHandle: makeWatcherHandle(),
      });
      expect(ctx.shuttingDown).toBe(true);
    });

    it("shutdown() calls workQueue.close()", async () => {
      const ctx = makeSchedulerCtx();
      await callShutdown({
        logger: makeLogger(),
        schedulerCtx: ctx,
        cronJobs: [],
        watcherHandle: makeWatcherHandle(),
      });
      expect(ctx.workQueue.close).toHaveBeenCalledOnce();
    });

    it("shutdown() calls job.stop() for each cron job", async () => {
      const ctx = makeSchedulerCtx();
      const job1 = makeCronJob();
      const job2 = makeCronJob();
      await callShutdown({
        logger: makeLogger(),
        schedulerCtx: ctx,
        cronJobs: [job1, job2],
        watcherHandle: makeWatcherHandle(),
      });
      expect(job1.stop).toHaveBeenCalledOnce();
      expect(job2.stop).toHaveBeenCalledOnce();
    });

    it("shutdown() calls gateway.close() when gateway is present", async () => {
      const ctx = makeSchedulerCtx();
      const gateway = makeGateway();
      await callShutdown({
        logger: makeLogger(),
        schedulerCtx: ctx,
        cronJobs: [],
        watcherHandle: makeWatcherHandle(),
        gateway,
      });
      expect(gateway.close).toHaveBeenCalledOnce();
    });

    it("shutdown() skips gateway.close() when gateway is undefined", async () => {
      const ctx = makeSchedulerCtx();
      const gateway = makeGateway();
      await callShutdown({
        logger: makeLogger(),
        schedulerCtx: ctx,
        cronJobs: [],
        watcherHandle: makeWatcherHandle(),
        // gateway omitted
      });
      // gateway.close should NOT be called because no gateway provided
      expect(gateway.close).not.toHaveBeenCalled();
    });

    it("shutdown() calls stateStore.close() when present", async () => {
      const ctx = makeSchedulerCtx();
      const stateStore = makeStateStore();
      await callShutdown({
        logger: makeLogger(),
        schedulerCtx: ctx,
        cronJobs: [],
        watcherHandle: makeWatcherHandle(),
        stateStore,
      });
      expect(stateStore.close).toHaveBeenCalledOnce();
    });

    it("shutdown() calls statsStore.close() when present", async () => {
      const ctx = makeSchedulerCtx();
      const statsStore = makeStatsStore();
      await callShutdown({
        logger: makeLogger(),
        schedulerCtx: ctx,
        cronJobs: [],
        watcherHandle: makeWatcherHandle(),
        statsStore,
      });
      expect(statsStore.close).toHaveBeenCalledOnce();
    });

    it("shutdown() calls sharedDb.$client.close() when present", async () => {
      const ctx = makeSchedulerCtx();
      const sharedDb = makeSharedDb();
      await callShutdown({
        logger: makeLogger(),
        schedulerCtx: ctx,
        cronJobs: [],
        watcherHandle: makeWatcherHandle(),
        sharedDb,
      });
      expect(sharedDb.$client.close).toHaveBeenCalledOnce();
    });

    it("shutdown() silently catches sharedDb.$client.close() throws", async () => {
      const ctx = makeSchedulerCtx();
      const sharedDb = { $client: { close: vi.fn(() => { throw new Error("DB close failed"); }) } };
      // Should not throw
      await expect(callShutdown({
        logger: makeLogger(),
        schedulerCtx: ctx,
        cronJobs: [],
        watcherHandle: makeWatcherHandle(),
        sharedDb,
      })).resolves.toBeUndefined();
    });

    it("shutdown() calls telemetry.shutdown() when present", async () => {
      const ctx = makeSchedulerCtx();
      const telemetry = makeTelemetry(false);
      await callShutdown({
        logger: makeLogger(),
        schedulerCtx: ctx,
        cronJobs: [],
        watcherHandle: makeWatcherHandle(),
        telemetry,
      });
      expect(telemetry.shutdown).toHaveBeenCalledOnce();
    });

    it("shutdown() telemetry.shutdown() throws → logged warn, does not crash", async () => {
      const ctx = makeSchedulerCtx();
      const telemetry = makeTelemetry(true); // throws
      const logger = makeLogger();
      // Should not throw
      await expect(callShutdown({
        logger,
        schedulerCtx: ctx,
        cronJobs: [],
        watcherHandle: makeWatcherHandle(),
        telemetry,
      })).resolves.toBeUndefined();
      // Should have logged a warning
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "telemetry shutdown failed" }),
        expect.stringMatching(/telemetry.*shutdown/i)
      );
    });

    it("shutdown() calls runtime.shutdown() when runtime has shutdown method", async () => {
      const ctx = makeSchedulerCtx();
      const runtime = makeRuntime(true);
      await callShutdown({
        logger: makeLogger(),
        schedulerCtx: ctx,
        cronJobs: [],
        watcherHandle: makeWatcherHandle(),
        runtime,
      });
      expect(runtime.shutdown).toHaveBeenCalledOnce();
    });

    it("shutdown() skips runtime.shutdown() when runtime has no shutdown method", async () => {
      const ctx = makeSchedulerCtx();
      const runtime = makeRuntime(false); // no shutdown method
      // Should not throw
      await expect(callShutdown({
        logger: makeLogger(),
        schedulerCtx: ctx,
        cronJobs: [],
        watcherHandle: makeWatcherHandle(),
        runtime,
      })).resolves.toBeUndefined();
    });

    it("shutdown() calls process.exit(0) at the end", async () => {
      const ctx = makeSchedulerCtx();
      await callShutdown({
        logger: makeLogger(),
        schedulerCtx: ctx,
        cronJobs: [],
        watcherHandle: makeWatcherHandle(),
      });
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });
  },
);
