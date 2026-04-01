/**
 * Unit tests for gateway/routes/execution.ts
 *
 * Verifies that registerExecutionRoutes delegates correctly to:
 * - registerLockRoutes with skipStatusEndpoint and events
 * - registerCallRoutes with callDispatcherProvider and events
 * - registerSignalRoutes with statusTracker, signalContext, and events
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../../src/execution/routes/locks.js", () => ({
  registerLockRoutes: vi.fn(),
}));

vi.mock("../../../src/execution/routes/calls.js", () => ({
  registerCallRoutes: vi.fn(),
}));

vi.mock("../../../src/execution/routes/signals.js", () => ({
  registerSignalRoutes: vi.fn(),
}));

import { registerExecutionRoutes } from "../../../src/gateway/routes/execution.js";
import { registerLockRoutes } from "../../../src/execution/routes/locks.js";
import { registerCallRoutes } from "../../../src/execution/routes/calls.js";
import { registerSignalRoutes } from "../../../src/execution/routes/signals.js";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any;

const mockContainerRegistry = {} as any;
const mockLockStore = {} as any;
const mockCallStore = {} as any;
const mockCallDispatcherProvider = vi.fn();
const mockStatusTracker = {} as any;
const mockSignalContext = {} as any;
const mockEvents = {} as any;

describe("registerExecutionRoutes", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
  });

  it("calls registerLockRoutes with correct arguments", () => {
    registerExecutionRoutes(app, {
      containerRegistry: mockContainerRegistry,
      lockStore: mockLockStore,
      callStore: mockCallStore,
      callDispatcherProvider: mockCallDispatcherProvider,
      logger: mockLogger,
      events: mockEvents,
    });

    expect(registerLockRoutes).toHaveBeenCalledWith(
      app,
      mockContainerRegistry,
      mockLockStore,
      mockLogger,
      { skipStatusEndpoint: undefined, events: mockEvents },
    );
  });

  it("passes skipStatusEndpoint to registerLockRoutes when provided", () => {
    registerExecutionRoutes(app, {
      containerRegistry: mockContainerRegistry,
      lockStore: mockLockStore,
      callStore: mockCallStore,
      callDispatcherProvider: mockCallDispatcherProvider,
      logger: mockLogger,
      skipStatusEndpoint: true,
    });

    expect(registerLockRoutes).toHaveBeenCalledWith(
      app,
      mockContainerRegistry,
      mockLockStore,
      mockLogger,
      { skipStatusEndpoint: true, events: undefined },
    );
  });

  it("calls registerCallRoutes with callDispatcherProvider and events", () => {
    registerExecutionRoutes(app, {
      containerRegistry: mockContainerRegistry,
      lockStore: mockLockStore,
      callStore: mockCallStore,
      callDispatcherProvider: mockCallDispatcherProvider,
      logger: mockLogger,
      events: mockEvents,
    });

    expect(registerCallRoutes).toHaveBeenCalledWith(
      app,
      mockContainerRegistry,
      mockCallStore,
      mockCallDispatcherProvider,
      mockLogger,
      mockEvents,
    );
  });

  it("calls registerSignalRoutes with statusTracker, signalContext, and events", () => {
    registerExecutionRoutes(app, {
      containerRegistry: mockContainerRegistry,
      lockStore: mockLockStore,
      callStore: mockCallStore,
      callDispatcherProvider: mockCallDispatcherProvider,
      logger: mockLogger,
      statusTracker: mockStatusTracker,
      signalContext: mockSignalContext,
      events: mockEvents,
    });

    expect(registerSignalRoutes).toHaveBeenCalledWith(
      app,
      mockContainerRegistry,
      mockLogger,
      mockStatusTracker,
      mockSignalContext,
      mockEvents,
    );
  });

  it("calls all three route registration functions in sequence", () => {
    registerExecutionRoutes(app, {
      containerRegistry: mockContainerRegistry,
      lockStore: mockLockStore,
      callStore: mockCallStore,
      callDispatcherProvider: mockCallDispatcherProvider,
      logger: mockLogger,
    });

    expect(registerLockRoutes).toHaveBeenCalledTimes(1);
    expect(registerCallRoutes).toHaveBeenCalledTimes(1);
    expect(registerSignalRoutes).toHaveBeenCalledTimes(1);
  });
});
