import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

// Mock the telemetry module before importing the middleware
vi.mock("../../../src/telemetry/index.js", () => ({
  getTelemetry: vi.fn(),
  withSpan: vi.fn(),
}));

import { applyTelemetryMiddleware } from "../../../src/gateway/middleware/telemetry.js";
import { getTelemetry, withSpan } from "../../../src/telemetry/index.js";

const mockGetTelemetry = vi.mocked(getTelemetry);
const mockWithSpan = vi.mocked(withSpan);

describe("applyTelemetryMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when getTelemetry returns null/undefined", async () => {
    mockGetTelemetry.mockReturnValue(undefined as any);

    const app = new Hono();
    app.get("/test", (c) => c.text("ok"));

    applyTelemetryMiddleware(app);

    // withSpan should never be called if telemetry is not enabled
    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(mockWithSpan).not.toHaveBeenCalled();
  });

  it("registers middleware when getTelemetry returns a telemetry instance", async () => {
    const mockTelemetry = { createSpan: vi.fn(), withSpan: vi.fn() };
    mockGetTelemetry.mockReturnValue(mockTelemetry as any);

    // Make withSpan execute the callback
    mockWithSpan.mockImplementation(async (_name, fn, _attrs, _kind) => {
      const mockSpan = { setAttributes: vi.fn(), end: vi.fn() };
      return fn(mockSpan as any);
    });

    const app = new Hono();
    // Register middleware BEFORE routes so Hono applies it
    applyTelemetryMiddleware(app);
    app.get("/api/test", (c) => c.json({ ok: true }));

    const res = await app.request("/api/test");
    expect(res.status).toBe(200);
    expect(mockWithSpan).toHaveBeenCalledOnce();
  });

  it("creates span with correct HTTP attributes", async () => {
    const mockTelemetry = { createSpan: vi.fn(), withSpan: vi.fn() };
    mockGetTelemetry.mockReturnValue(mockTelemetry as any);

    let capturedSpanName: string | undefined;
    let capturedAttrs: Record<string, any> | undefined;
    let capturedAfterAttrs: Record<string, any> | undefined;

    mockWithSpan.mockImplementation(async (name, fn, _attrs, _kind) => {
      capturedSpanName = name;
      const mockSpan = {
        setAttributes: vi.fn((attrs) => {
          if (!capturedAttrs) {
            capturedAttrs = attrs;
          } else {
            capturedAfterAttrs = attrs;
          }
        }),
        end: vi.fn(),
      };
      return fn(mockSpan as any);
    });

    const app = new Hono();
    applyTelemetryMiddleware(app);
    app.get("/api/health", (c) => c.json({ status: "ok" }));

    await app.request("http://localhost/api/health", {
      method: "GET",
      headers: { "user-agent": "test-agent/1.0" },
    });

    expect(capturedSpanName).toBe("gateway.get_api_health");
    expect(capturedAttrs).toMatchObject({
      "http.method": "GET",
      "http.path": "/api/health",
      "http.user_agent": "test-agent/1.0",
      "gateway.component": "http_server",
    });
    expect(capturedAfterAttrs).toMatchObject({
      "http.status_code": 200,
    });
  });

  it("normalizes span name for root path to 'root'", async () => {
    const mockTelemetry = { createSpan: vi.fn() };
    mockGetTelemetry.mockReturnValue(mockTelemetry as any);

    let capturedSpanName: string | undefined;
    mockWithSpan.mockImplementation(async (name, fn, _attrs, _kind) => {
      capturedSpanName = name;
      const mockSpan = { setAttributes: vi.fn(), end: vi.fn() };
      return fn(mockSpan as any);
    });

    const app = new Hono();
    applyTelemetryMiddleware(app);
    app.get("/", (c) => c.text("root"));

    await app.request("/");

    expect(capturedSpanName).toBe("gateway.get_root");
  });

  it("normalizes span name by replacing slashes with underscores and trimming", async () => {
    const mockTelemetry = { createSpan: vi.fn() };
    mockGetTelemetry.mockReturnValue(mockTelemetry as any);

    let capturedSpanName: string | undefined;
    mockWithSpan.mockImplementation(async (name, fn, _attrs, _kind) => {
      capturedSpanName = name;
      const mockSpan = { setAttributes: vi.fn(), end: vi.fn() };
      return fn(mockSpan as any);
    });

    const app = new Hono();
    applyTelemetryMiddleware(app);
    app.post("/api/agents/:name/runs", (c) => c.json({ ok: true }));

    await app.request("/api/agents/myagent/runs", { method: "POST" });

    // slashes become underscores, leading/trailing underscores stripped
    expect(capturedSpanName).toBe("gateway.post_api_agents_myagent_runs");
  });

  it("sets empty string for user-agent when header is missing", async () => {
    const mockTelemetry = { createSpan: vi.fn() };
    mockGetTelemetry.mockReturnValue(mockTelemetry as any);

    let capturedAttrs: Record<string, any> | undefined;
    mockWithSpan.mockImplementation(async (_name, fn, _attrs, _kind) => {
      const mockSpan = {
        setAttributes: vi.fn((attrs) => {
          if (!capturedAttrs) capturedAttrs = attrs;
        }),
        end: vi.fn(),
      };
      return fn(mockSpan as any);
    });

    const app = new Hono();
    applyTelemetryMiddleware(app);
    app.get("/test", (c) => c.text("ok"));

    await app.request("/test"); // no user-agent header

    expect(capturedAttrs?.["http.user_agent"]).toBe("");
  });

  it("passes SpanKind.SERVER to withSpan", async () => {
    const { SpanKind } = await import("@opentelemetry/api");
    const mockTelemetry = { createSpan: vi.fn() };
    mockGetTelemetry.mockReturnValue(mockTelemetry as any);

    let capturedKind: any;
    mockWithSpan.mockImplementation(async (_name, fn, _attrs, kind) => {
      capturedKind = kind;
      const mockSpan = { setAttributes: vi.fn(), end: vi.fn() };
      return fn(mockSpan as any);
    });

    const app = new Hono();
    applyTelemetryMiddleware(app);
    app.get("/test", (c) => c.text("ok"));

    await app.request("/test");

    expect(capturedKind).toBe(SpanKind.SERVER);
  });
});
