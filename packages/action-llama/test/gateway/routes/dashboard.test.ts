/**
 * Unit tests for gateway/routes/dashboard.ts
 *
 * Verifies that registerDashboardRoutes:
 * 1. Calls registerDashboardDataRoutes with app and statusTracker
 * 2. Calls registerDashboardApiRoutes with correct args
 * 3. Registers log routes when projectPath is provided
 * 4. Does NOT register log routes when projectPath is absent
 * 5. Registers stats routes
 * 6. Registers root redirect to /dashboard
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../../src/control/routes/dashboard.js", () => ({
  registerDashboardDataRoutes: vi.fn(),
}));

vi.mock("../../../src/control/routes/dashboard-api.js", () => ({
  registerDashboardApiRoutes: vi.fn(),
  registerAuthApiRoutes: vi.fn(),
}));

vi.mock("../../../src/control/routes/logs.js", () => ({
  registerLogRoutes: vi.fn(),
}));

vi.mock("../../../src/control/routes/log-summary.js", () => ({
  registerLogSummaryRoutes: vi.fn(),
}));

vi.mock("../../../src/control/routes/stats.js", () => ({
  registerStatsRoutes: vi.fn(),
}));

import { registerDashboardRoutes } from "../../../src/gateway/routes/dashboard.js";
import { registerDashboardDataRoutes } from "../../../src/control/routes/dashboard.js";
import { registerDashboardApiRoutes } from "../../../src/control/routes/dashboard-api.js";
import { registerLogRoutes } from "../../../src/control/routes/logs.js";
import { registerLogSummaryRoutes } from "../../../src/control/routes/log-summary.js";
import { registerStatsRoutes } from "../../../src/control/routes/stats.js";

const mockStatusTracker = {
  getAllAgents: vi.fn().mockReturnValue([]),
  getSchedulerInfo: vi.fn().mockReturnValue(null),
  getRecentLogs: vi.fn().mockReturnValue([]),
  getInstances: vi.fn().mockReturnValue([]),
  on: vi.fn(),
  removeListener: vi.fn(),
} as any;

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any;

describe("registerDashboardRoutes", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
  });

  it("calls registerDashboardDataRoutes with app and statusTracker", async () => {
    await registerDashboardRoutes(app, {
      statusTracker: mockStatusTracker,
      apiKey: "test-key",
      logger: mockLogger,
    });

    expect(registerDashboardDataRoutes).toHaveBeenCalledWith(app, mockStatusTracker);
  });

  it("calls registerDashboardApiRoutes with app, statusTracker, projectPath, and statsStore", async () => {
    const mockStatsStore = {} as any;
    await registerDashboardRoutes(app, {
      statusTracker: mockStatusTracker,
      projectPath: "/tmp/project",
      apiKey: "test-key",
      statsStore: mockStatsStore,
      logger: mockLogger,
    });

    expect(registerDashboardApiRoutes).toHaveBeenCalledWith(
      app,
      mockStatusTracker,
      "/tmp/project",
      mockStatsStore,
    );
  });

  it("registers log routes when projectPath is provided", async () => {
    const mockStatsStore = {} as any;
    await registerDashboardRoutes(app, {
      statusTracker: mockStatusTracker,
      projectPath: "/tmp/project",
      apiKey: "test-key",
      statsStore: mockStatsStore,
      logger: mockLogger,
    });

    expect(registerLogRoutes).toHaveBeenCalledWith(app, "/tmp/project");
    expect(registerLogSummaryRoutes).toHaveBeenCalledWith(app, "/tmp/project", mockStatsStore);
  });

  it("does NOT register log routes when projectPath is absent", async () => {
    await registerDashboardRoutes(app, {
      statusTracker: mockStatusTracker,
      apiKey: "test-key",
      logger: mockLogger,
    });

    expect(registerLogRoutes).not.toHaveBeenCalled();
    expect(registerLogSummaryRoutes).not.toHaveBeenCalled();
  });

  it("calls registerStatsRoutes with app, statsStore, statusTracker, and controlDeps", async () => {
    const mockStatsStore = {} as any;
    const mockControlDeps = {} as any;
    await registerDashboardRoutes(app, {
      statusTracker: mockStatusTracker,
      statsStore: mockStatsStore,
      apiKey: "test-key",
      logger: mockLogger,
      controlDeps: mockControlDeps,
    });

    expect(registerStatsRoutes).toHaveBeenCalledWith(
      app,
      mockStatsStore,
      mockStatusTracker,
      mockControlDeps,
    );
  });

  it("registers root redirect GET / → /dashboard", async () => {
    await registerDashboardRoutes(app, {
      statusTracker: mockStatusTracker,
      apiKey: "test-key",
      logger: mockLogger,
    });

    const res = await app.request("/", undefined, {});
    // Redirect to /dashboard
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
  });
});
