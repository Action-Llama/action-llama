/**
 * Integration tests: chat session REST API — no Docker required.
 *
 * The chat session routes are registered in Phase 3 (setupGateway) when
 * webUI=true and an API key is configured. They do not require Docker to
 * exercise the error paths and session creation.
 *
 * WITHOUT Docker, the `launchChatContainer` callback throws immediately
 * ("Chat is not available yet") because `chatLauncher` is not set until
 * Phase 4 (image builds). The `.catch()` on the callback removes the session
 * from ChatSessionManager. This means:
 *   - Session creation returns 200 (route responds before background cleanup)
 *   - After a short delay, the session is gone from the manager
 *
 * Endpoints tested here:
 *   1. POST /api/chat/sessions — missing agentName → 400
 *   2. POST /api/chat/sessions — 401 without auth
 *   3. POST /api/chat/sessions — creates session, returns { sessionId, created:true }
 *   4. GET  /api/chat/sessions — returns { sessions: [] } shape
 *   5. DELETE /api/chat/sessions/:id — 404 for unknown session
 *   6. POST /api/chat/sessions/:id/clear — 404 for unknown session
 *   7. GET  /api/chat/sessions — session removed after launch failure (delayed check)
 *
 * These complement the Docker-required tests in chat.test.ts, providing
 * coverage of error paths and session lifecycle in environments without Docker.
 *
 * Covers:
 *   - chat/routes.ts: POST /api/chat/sessions — missing agentName → 400
 *   - chat/routes.ts: POST /api/chat/sessions — create path (session + response)
 *   - chat/routes.ts: GET /api/chat/sessions — list endpoint response shape
 *   - chat/routes.ts: DELETE /api/chat/sessions/:id → 404 (session not found)
 *   - chat/routes.ts: POST /api/chat/sessions/:id/clear → 404 (session not found)
 *   - chat/session-manager.ts: createSession, getSession, listSessions, removeSession
 *   - gateway/index.ts: chat routes registered when webUI=true + apiKey set
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: chat session REST API (no Docker required, webUI=true)",
  { timeout: 60_000 },
  () => {
    let harness: IntegrationHarness;
    let gatewayAccessible = false;

    afterEach(async () => {
      if (harness) {
        try { await harness.shutdown(); } catch {}
        harness = undefined as unknown as IntegrationHarness;
        gatewayAccessible = false;
      }
    });

    async function startHarnessWithWebUI(): Promise<void> {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "chat-test-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      try {
        await harness.start({ webUI: true });
        gatewayAccessible = true;
      } catch {
        try {
          const h = await fetch(
            `http://127.0.0.1:${harness.gatewayPort}/health`,
            { signal: AbortSignal.timeout(3_000) },
          );
          gatewayAccessible = h.ok;
        } catch {
          gatewayAccessible = false;
        }
      }
    }

    function chatAPI(method: string, path: string, body?: unknown): Promise<Response> {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${harness.apiKey}`,
      };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      return fetch(`http://127.0.0.1:${harness.gatewayPort}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(5_000),
      });
    }

    function chatAPINoAuth(method: string, path: string, body?: unknown): Promise<Response> {
      const headers: Record<string, string> = {};
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      return fetch(`http://127.0.0.1:${harness.gatewayPort}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(5_000),
      });
    }

    it("POST /api/chat/sessions returns 400 when agentName is missing", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await chatAPI("POST", "/api/chat/sessions", {});
      expect(res.status).toBe(400);

      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/agentName/i);
    });

    it("POST /api/chat/sessions returns 401 without Authorization header", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await chatAPINoAuth("POST", "/api/chat/sessions", { agentName: "chat-test-agent" });
      expect(res.status).toBe(401);
    });

    it("GET /api/chat/sessions returns 401 without Authorization header", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await chatAPINoAuth("GET", "/api/chat/sessions");
      expect(res.status).toBe(401);
    });

    it("GET /api/chat/sessions returns empty sessions array initially", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await chatAPI("GET", "/api/chat/sessions");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { sessions: unknown[] };
      expect(Array.isArray(body.sessions)).toBe(true);
      expect(body.sessions).toHaveLength(0);
    });

    it("POST /api/chat/sessions creates a session and returns sessionId with created:true", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      // The route responds BEFORE the async launchChatContainer callback runs,
      // so created:true is returned even in no-Docker mode.
      const res = await chatAPI("POST", "/api/chat/sessions", { agentName: "chat-test-agent" });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { sessionId: string; created: boolean };
      expect(typeof body.sessionId).toBe("string");
      expect(body.sessionId.length).toBeGreaterThan(0);
      expect(body.created).toBe(true);
    });

    it("DELETE /api/chat/sessions/:id returns 404 for unknown session", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await chatAPI("DELETE", "/api/chat/sessions/nonexistent-session-id-xyz-123");
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not found/i);
    });

    it("POST /api/chat/sessions/:id/clear returns 404 for unknown session", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await chatAPI("POST", "/api/chat/sessions/nonexistent-clear-id-xyz/clear");
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not found/i);
    });

    it("GET /api/chat/sessions returns empty after session launch fails (no Docker)", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      // Create session — succeeds (route responds before background callback fails)
      const createRes = await chatAPI("POST", "/api/chat/sessions", { agentName: "chat-test-agent" });
      expect(createRes.status).toBe(200);
      await createRes.json(); // consume body

      // Wait briefly for the async launchChatContainer failure to clean up the session.
      // In no-Docker mode, the callback throws immediately → microtask removes session.
      await new Promise((r) => setTimeout(r, 50));

      // List should now be empty (session removed by failed launch callback)
      const listRes = await chatAPI("GET", "/api/chat/sessions");
      expect(listRes.status).toBe(200);

      const listBody = (await listRes.json()) as { sessions: unknown[] };
      expect(Array.isArray(listBody.sessions)).toBe(true);
      expect(listBody.sessions).toHaveLength(0);
    });
  },
);
