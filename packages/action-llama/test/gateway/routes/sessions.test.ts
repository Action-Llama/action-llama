import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { registerSessionRoutes } from "../../../src/control/routes/sessions.js";
import type { StatusTracker } from "../../../src/tui/status-tracker.js";

function makeMockTracker(sessions: any[] = []) {
  return {
    getSessions: vi.fn(() => sessions),
  } as unknown as StatusTracker;
}

const running = { id: "sess-1", agentName: "alpha", status: "running", startedAt: new Date(), trigger: "schedule" };
const waiting = { id: "sess-2", agentName: "beta",  status: "waiting", startedAt: new Date(), trigger: "webhook" };
const completed = { id: "sess-3", agentName: "gamma", status: "completed", startedAt: new Date(), trigger: "schedule" };

describe("registerSessionRoutes", () => {
  describe("GET /sessions", () => {
    it("returns only running and waiting sessions", async () => {
      const app = new Hono();
      registerSessionRoutes(app, { statusTracker: makeMockTracker([running, waiting, completed]) });

      const res = await app.request("/sessions");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessions).toHaveLength(2);
      expect(body.sessions.map((s: any) => s.id)).toEqual(["sess-1", "sess-2"]);
    });

    it("returns 503 if statusTracker not available", async () => {
      const app = new Hono();
      registerSessionRoutes(app, {});

      const res = await app.request("/sessions");
      expect(res.status).toBe(503);
    });
  });

  describe("GET /sessions/:id", () => {
    it("returns a session by ID", async () => {
      const app = new Hono();
      registerSessionRoutes(app, { statusTracker: makeMockTracker([running, waiting]) });

      const res = await app.request("/sessions/sess-1");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.session.id).toBe("sess-1");
    });

    it("returns 404 for unknown session ID", async () => {
      const app = new Hono();
      registerSessionRoutes(app, { statusTracker: makeMockTracker([running]) });

      const res = await app.request("/sessions/unknown");
      expect(res.status).toBe(404);
    });

    it("returns 503 if statusTracker not available", async () => {
      const app = new Hono();
      registerSessionRoutes(app, {});

      const res = await app.request("/sessions/any-id");
      expect(res.status).toBe(503);
    });
  });
});
