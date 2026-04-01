/**
 * Unit tests for gateway/middleware/request-logging.ts
 *
 * Verifies that:
 * 1. /health requests are skipped (no logging)
 * 2. 2xx responses use logger.debug("request completed")
 * 3. 4xx+ responses use logger.warn("request completed with error")
 * 4. Both "request received" and completion messages are logged for non-health paths
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { applyRequestLoggingMiddleware } from "../../../src/gateway/middleware/request-logging.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("applyRequestLoggingMiddleware", () => {
  let app: Hono;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    app = new Hono();
    applyRequestLoggingMiddleware(app, logger);
    // Register a few test routes
    app.get("/health", (c) => c.json({ status: "ok" }));
    app.get("/api/data", (c) => c.json({ data: "hello" }));
    app.get("/api/error", (c) => c.json({ error: "not found" }, 404));
    app.get("/api/server-error", (c) => c.json({ error: "internal" }, 500));
  });

  it("skips logging for /health requests (no debug or warn called)", async () => {
    await app.request("/health");

    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("logs 'request received' and 'request completed' (debug) for 2xx responses", async () => {
    const res = await app.request("/api/data");
    expect(res.status).toBe(200);

    // Should have called debug twice: "request received" + "request completed"
    expect(logger.debug).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/api/data" }),
      "request received",
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/api/data", status: 200 }),
      "request completed",
    );

    // No warn should have been called
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs 'request completed with error' (warn) for 4xx responses", async () => {
    const res = await app.request("/api/error");
    expect(res.status).toBe(404);

    // Should have called debug once: "request received"
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/api/error" }),
      "request received",
    );

    // Should have called warn once: "request completed with error"
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/api/error", status: 404 }),
      "request completed with error",
    );
  });

  it("logs warn for 5xx responses", async () => {
    const res = await app.request("/api/server-error");
    expect(res.status).toBe(500);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/api/server-error", status: 500 }),
      "request completed with error",
    );
  });

  it("includes numeric duration field in log data", async () => {
    await app.request("/api/data");

    const debugCalls = logger.debug.mock.calls;
    const completionCall = debugCalls.find((call) => call[1] === "request completed");
    expect(completionCall).toBeDefined();
    const logData = completionCall![0] as Record<string, unknown>;
    expect(typeof logData.duration).toBe("number");
    expect(logData.duration).toBeGreaterThanOrEqual(0);
  });

  it("logs correct HTTP method (POST, not GET)", async () => {
    app.post("/api/submit", (c) => c.json({ ok: true }));

    await app.request("/api/submit", { method: "POST" });

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: "/api/submit" }),
      "request received",
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: "/api/submit", status: 200 }),
      "request completed",
    );
  });
});
