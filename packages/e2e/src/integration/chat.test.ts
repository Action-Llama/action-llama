/**
 * Integration test: chat session management REST API.
 *
 * Tests the chat session endpoints introduced for interactive agent chat:
 *   POST   /api/chat/sessions                  — create or return existing session
 *   DELETE /api/chat/sessions/:sessionId        — delete a session
 *   POST   /api/chat/sessions/:sessionId/clear  — clear session context (stop + new session)
 *
 * These routes are only registered when the gateway starts with webUI=true.
 * The test exercises the session lifecycle without requiring the chat WebSocket
 * or the background container to complete successfully.
 *
 * Covers: chat/routes.ts (all three REST endpoints) and chat/session-manager.ts
 * (create, get, remove, canCreate, getSessionByAgent).
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: chat session management API", { timeout: 300_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  /** Call the chat API with the harness API key. */
  function chatAPI(
    h: IntegrationHarness,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${h.apiKey}`,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  it("POST /api/chat/sessions returns 400 when agentName is missing", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "chat-missing-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    // Start with webUI=true to enable chat routes
    await harness.start({ webUI: true });

    // POST without agentName
    const res = await chatAPI(harness, "POST", "/api/chat/sessions", {});
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/agentName/i);
  });

  it("POST /api/chat/sessions creates a new session for an agent", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "chat-create-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start({ webUI: true });

    // Trigger and wait for one run so the image is built and the agent is ready
    await harness.triggerAgent("chat-create-agent");
    await harness.waitForRunResult("chat-create-agent");

    // Create a chat session
    const res = await chatAPI(harness, "POST", "/api/chat/sessions", {
      agentName: "chat-create-agent",
    });
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body).toHaveProperty("sessionId");
    expect(typeof body.sessionId).toBe("string");
    expect(body.sessionId.length).toBeGreaterThan(0);
    expect(body.created).toBe(true);
  });

  it("POST /api/chat/sessions is idempotent — returns existing session for same agent", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "chat-idempotent-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start({ webUI: true });

    // Build agent image first
    await harness.triggerAgent("chat-idempotent-agent");
    await harness.waitForRunResult("chat-idempotent-agent");

    // First session creation
    const res1 = await chatAPI(harness, "POST", "/api/chat/sessions", {
      agentName: "chat-idempotent-agent",
    });
    expect(res1.ok).toBe(true);
    const body1 = await res1.json();
    expect(body1.created).toBe(true);
    const sessionId = body1.sessionId;

    // Second creation for same agent — should return the existing session
    const res2 = await chatAPI(harness, "POST", "/api/chat/sessions", {
      agentName: "chat-idempotent-agent",
    });
    expect(res2.ok).toBe(true);
    const body2 = await res2.json();
    expect(body2.created).toBe(false);
    expect(body2.sessionId).toBe(sessionId); // same session returned
  });

  it("DELETE /api/chat/sessions/:sessionId removes the session", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "chat-delete-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start({ webUI: true });

    // Build agent image first
    await harness.triggerAgent("chat-delete-agent");
    await harness.waitForRunResult("chat-delete-agent");

    // Create session
    const createRes = await chatAPI(harness, "POST", "/api/chat/sessions", {
      agentName: "chat-delete-agent",
    });
    expect(createRes.ok).toBe(true);
    const { sessionId } = await createRes.json();

    // Delete the session
    const deleteRes = await chatAPI(harness, "DELETE", `/api/chat/sessions/${sessionId}`);
    expect(deleteRes.ok).toBe(true);

    // After deletion, creating a new session for the same agent should succeed with created=true
    const createRes2 = await chatAPI(harness, "POST", "/api/chat/sessions", {
      agentName: "chat-delete-agent",
    });
    expect(createRes2.ok).toBe(true);
    const body2 = await createRes2.json();
    expect(body2.created).toBe(true); // New session, not the old one
    expect(body2.sessionId).not.toBe(sessionId);

    // Cleanup: delete the new session too
    await chatAPI(harness, "DELETE", `/api/chat/sessions/${body2.sessionId}`);
  });

  it("DELETE /api/chat/sessions/:sessionId returns 404 for nonexistent session", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "chat-delete-notfound-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start({ webUI: true });

    const res = await chatAPI(
      harness,
      "DELETE",
      "/api/chat/sessions/nonexistent-session-id-12345",
    );
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/not found/i);
  });

  it("POST /api/chat/sessions/:sessionId/clear returns 404 for nonexistent session", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "chat-clear-notfound-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start({ webUI: true });

    const res = await chatAPI(
      harness,
      "POST",
      "/api/chat/sessions/nonexistent-session-id-99999/clear",
    );
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/not found/i);
  });

  it("POST /api/chat/sessions/:sessionId/clear creates a new session with a fresh id", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "chat-clear-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start({ webUI: true });

    // Build agent image first
    await harness.triggerAgent("chat-clear-agent");
    await harness.waitForRunResult("chat-clear-agent");

    // Create session
    const createRes = await chatAPI(harness, "POST", "/api/chat/sessions", {
      agentName: "chat-clear-agent",
    });
    expect(createRes.ok).toBe(true);
    const { sessionId: originalId } = await createRes.json();

    // Clear the session context — should return a new session id
    const clearRes = await chatAPI(
      harness,
      "POST",
      `/api/chat/sessions/${originalId}/clear`,
    );
    expect(clearRes.ok).toBe(true);

    const clearBody = await clearRes.json();
    expect(clearBody).toHaveProperty("sessionId");
    expect(typeof clearBody.sessionId).toBe("string");
    // New session should have a different ID
    expect(clearBody.sessionId).not.toBe(originalId);

    // Cleanup: delete the new session
    await chatAPI(harness, "DELETE", `/api/chat/sessions/${clearBody.sessionId}`);
  });

  it("GET /api/chat/sessions lists active sessions", async () => {
    // The GET /api/chat/sessions endpoint returns all active chat sessions.
    // After creating a session, it should appear in the list.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "chat-list-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'list-agent'\nexit 0\n",
        },
      ],
    });

    // Start with webUI=true to enable chat routes
    await harness.start({ webUI: true });

    // Build agent image first
    await harness.triggerAgent("chat-list-agent");
    await harness.waitForRunResult("chat-list-agent");

    // Initially, no sessions should exist
    const emptyRes = await chatAPI(harness, "GET", "/api/chat/sessions");
    expect(emptyRes.ok).toBe(true);
    const emptyBody = await emptyRes.json();
    expect(Array.isArray(emptyBody.sessions)).toBe(true);
    const initialCount = emptyBody.sessions.length;

    // Create a session
    const createRes = await chatAPI(harness, "POST", "/api/chat/sessions", {
      agentName: "chat-list-agent",
    });
    expect(createRes.ok).toBe(true);
    const { sessionId } = await createRes.json();

    // List sessions — should include the new one
    const listRes = await chatAPI(harness, "GET", "/api/chat/sessions");
    expect(listRes.ok).toBe(true);
    const listBody = await listRes.json();
    expect(Array.isArray(listBody.sessions)).toBe(true);
    expect(listBody.sessions.length).toBe(initialCount + 1);

    const found = listBody.sessions.find((s: any) => s.sessionId === sessionId);
    expect(found).toBeTruthy();
    expect(found.agentName).toBe("chat-list-agent");
    expect(found).toHaveProperty("createdAt");
    expect(found).toHaveProperty("lastActivityAt");

    // Cleanup
    await chatAPI(harness, "DELETE", `/api/chat/sessions/${sessionId}`);
  });

  it("POST /api/chat/sessions returns 429 when session limit is reached", async () => {
    // When maxChatSessions is set to 1, creating a second session for a
    // different agent should return 429 (session limit reached).
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "chat-limit-a",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
        {
          name: "chat-limit-b",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        gateway: { maxChatSessions: 1 },
      },
    });

    // Start with webUI=true to enable chat routes
    await harness.start({ webUI: true });

    // Build agent images
    await harness.triggerAgent("chat-limit-a");
    await harness.triggerAgent("chat-limit-b");
    await harness.waitForRunResult("chat-limit-a");
    await harness.waitForRunResult("chat-limit-b");

    // Create the first session (within limit)
    const firstRes = await chatAPI(harness, "POST", "/api/chat/sessions", {
      agentName: "chat-limit-a",
    });
    expect(firstRes.ok).toBe(true);
    const { sessionId } = await firstRes.json();

    // Try to create a second session for a different agent — should hit the limit
    const secondRes = await chatAPI(harness, "POST", "/api/chat/sessions", {
      agentName: "chat-limit-b",
    });
    expect(secondRes.status).toBe(429);
    const secondBody = await secondRes.json();
    expect(secondBody).toHaveProperty("error");
    expect(secondBody.error).toContain("limit");

    // Cleanup
    await chatAPI(harness, "DELETE", `/api/chat/sessions/${sessionId}`);
  });
});
