/**
 * Unit tests for gateway/routes/webhooks.ts
 *
 * Verifies that registerGatewayWebhookRoutes delegates correctly to
 * registerWebhookRoutes with all required options.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../../src/events/routes/webhooks.js", () => ({
  registerWebhookRoutes: vi.fn(),
}));

import { registerGatewayWebhookRoutes } from "../../../src/gateway/routes/webhooks.js";
import { registerWebhookRoutes } from "../../../src/events/routes/webhooks.js";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any;

describe("registerGatewayWebhookRoutes", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
  });

  it("delegates to registerWebhookRoutes with all provided options", () => {
    const mockRegistry = {} as any;
    const webhookSecrets = { github: { default: "secret123" } };
    const webhookConfigs = { github: { type: "github", allowUnsigned: false } as any };
    const mockStatusTracker = {} as any;
    const mockStatsStore = {} as any;

    registerGatewayWebhookRoutes(app, {
      webhookRegistry: mockRegistry,
      webhookSecrets,
      webhookConfigs,
      logger: mockLogger,
      statusTracker: mockStatusTracker,
      statsStore: mockStatsStore,
    });

    expect(registerWebhookRoutes).toHaveBeenCalledWith(
      app,
      mockRegistry,
      webhookSecrets,
      webhookConfigs,
      mockLogger,
      mockStatusTracker,
      mockStatsStore,
    );
  });

  it("passes undefined statusTracker when not provided", () => {
    const mockRegistry = {} as any;

    registerGatewayWebhookRoutes(app, {
      webhookRegistry: mockRegistry,
      webhookSecrets: {},
      webhookConfigs: {},
      logger: mockLogger,
    });

    expect(registerWebhookRoutes).toHaveBeenCalledWith(
      app,
      mockRegistry,
      {},
      {},
      mockLogger,
      undefined,
      undefined,
    );
  });

  it("calls registerWebhookRoutes exactly once", () => {
    registerGatewayWebhookRoutes(app, {
      webhookRegistry: {} as any,
      webhookSecrets: {},
      webhookConfigs: {},
      logger: mockLogger,
    });

    expect(registerWebhookRoutes).toHaveBeenCalledTimes(1);
  });
});
