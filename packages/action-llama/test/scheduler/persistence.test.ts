import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db migration module
const mockRunMigrations = vi.fn().mockReturnValue({ _mockDb: true });
vi.mock("../../src/db/migrate.js", () => ({
  runMigrations: (...args: any[]) => mockRunMigrations(...args),
  applyMigrations: vi.fn(),
  defaultMigrationsFolder: vi.fn().mockReturnValue("/mock/drizzle"),
}));

// Mock path module — keep the real module but spy on resolve
vi.mock("path", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual };
});

// Mock url module
vi.mock("url", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual };
});

// Mock shared/paths.js
vi.mock("../../src/shared/paths.js", () => ({
  dbPath: vi.fn().mockReturnValue("/tmp/mock-project/.al/action-llama.db"),
  projectDir: vi.fn().mockReturnValue("/tmp/mock-project/.al"),
  stateDir: vi.fn().mockReturnValue("/tmp/mock-project/.al/state"),
  logsDir: vi.fn().mockReturnValue("/tmp/mock-project/.al/logs"),
}));

// Mock SqliteStateStore
const mockSqliteStateStore = vi.fn();
vi.mock("../../src/shared/state-store-sqlite.js", () => ({
  SqliteStateStore: class MockSqliteStateStore {
    constructor(...args: any[]) {
      mockSqliteStateStore(...args);
    }
    get = vi.fn();
    set = vi.fn().mockResolvedValue(undefined);
    delete = vi.fn().mockResolvedValue(undefined);
    list = vi.fn().mockResolvedValue([]);
    close = vi.fn().mockResolvedValue(undefined);
  },
}));

// Mock StatsStore
const mockStatsPrune = vi.fn().mockReturnValue({ runs: 0, callEdges: 0, receipts: 0 });
const mockStatsStoreCtor = vi.fn();
vi.mock("../../src/stats/index.js", () => ({
  StatsStore: class MockStatsStore {
    prune = mockStatsPrune;
    constructor(...args: any[]) {
      mockStatsStoreCtor(...args);
    }
  },
}));

// Mock SqliteWorkQueue
const mockSqliteWorkQueueCtor = vi.fn();
vi.mock("../../src/events/event-queue-sqlite.js", () => ({
  SqliteWorkQueue: class MockSqliteWorkQueue {
    enqueue = vi.fn().mockReturnValue({ dropped: false });
    dequeue = vi.fn().mockReturnValue(null);
    size = vi.fn().mockReturnValue(0);
    drain = vi.fn();
    constructor(...args: any[]) {
      mockSqliteWorkQueueCtor(...args);
    }
  },
}));

import { createPersistence } from "../../src/scheduler/persistence.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  } as any;
}

describe("createPersistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls runMigrations and returns sharedDb", async () => {
    const globalConfig = {} as any;
    const logger = makeLogger();

    const result = await createPersistence("/tmp/project", globalConfig, logger);

    expect(mockRunMigrations).toHaveBeenCalledTimes(1);
    expect(result.sharedDb).toBeDefined();
    expect(logger.info).toHaveBeenCalledWith("Database: SQLite (.al/action-llama.db)");
  });

  it("creates SqliteStateStore with the shared DB", async () => {
    const globalConfig = {} as any;
    const logger = makeLogger();

    const result = await createPersistence("/tmp/project", globalConfig, logger);

    expect(mockSqliteStateStore).toHaveBeenCalledWith(result.sharedDb);
    expect(result.stateStore).toBeDefined();
    expect(logger.info).toHaveBeenCalledWith("State store: SQLite (.al/action-llama.db)");
  });

  it("creates StatsStore with the shared DB and calls prune with default 14 days", async () => {
    const globalConfig = {} as any;
    const logger = makeLogger();

    const result = await createPersistence("/tmp/project", globalConfig, logger);

    expect(mockStatsStoreCtor).toHaveBeenCalledWith(result.sharedDb);
    expect(mockStatsPrune).toHaveBeenCalledWith(14);
    expect(result.statsStore).toBeDefined();
    expect(logger.info).toHaveBeenCalledWith("Stats store: SQLite (.al/action-llama.db)");
  });

  it("calls prune with historyRetentionDays from config when provided", async () => {
    const globalConfig = { historyRetentionDays: 30 } as any;
    const logger = makeLogger();

    await createPersistence("/tmp/project", globalConfig, logger);

    expect(mockStatsPrune).toHaveBeenCalledWith(30);
  });

  it("logs pruned data when prune returns non-zero counts", async () => {
    mockStatsPrune.mockReturnValueOnce({ runs: 5, callEdges: 12, receipts: 3 });
    const globalConfig = {} as any;
    const logger = makeLogger();

    await createPersistence("/tmp/project", globalConfig, logger);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ prunedRuns: 5, prunedCallEdges: 12, prunedReceipts: 3 }),
      "Pruned old stats data"
    );
  });

  it("does not log pruned data when prune returns all zeros", async () => {
    mockStatsPrune.mockReturnValueOnce({ runs: 0, callEdges: 0, receipts: 0 });
    const globalConfig = {} as any;
    const logger = makeLogger();

    await createPersistence("/tmp/project", globalConfig, logger);

    expect(logger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ prunedRuns: 0 }),
      "Pruned old stats data"
    );
  });

  it("creates SqliteWorkQueue with default queue size 20", async () => {
    const globalConfig = {} as any;
    const logger = makeLogger();

    const result = await createPersistence("/tmp/project", globalConfig, logger);

    expect(mockSqliteWorkQueueCtor).toHaveBeenCalledWith(20, result.sharedDb);
    expect(result.workQueue).toBeDefined();
  });

  it("uses workQueueSize from config when provided", async () => {
    const globalConfig = { workQueueSize: 50 } as any;
    const logger = makeLogger();

    const result = await createPersistence("/tmp/project", globalConfig, logger);

    expect(mockSqliteWorkQueueCtor).toHaveBeenCalledWith(50, result.sharedDb);
  });

  it("falls back to webhookQueueSize when workQueueSize is not set", async () => {
    const globalConfig = { webhookQueueSize: 30 } as any;
    const logger = makeLogger();

    const result = await createPersistence("/tmp/project", globalConfig, logger);

    expect(mockSqliteWorkQueueCtor).toHaveBeenCalledWith(30, result.sharedDb);
  });

  it("workQueueSize takes precedence over webhookQueueSize", async () => {
    const globalConfig = { workQueueSize: 40, webhookQueueSize: 10 } as any;
    const logger = makeLogger();

    const result = await createPersistence("/tmp/project", globalConfig, logger);

    expect(mockSqliteWorkQueueCtor).toHaveBeenCalledWith(40, result.sharedDb);
  });
});
