import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startGateway } from "../../src/gateway/index.js";

describe("Gateway chat integration", () => {
  let gateway: any;
  let baseUrl: string;
  const TEST_API_KEY = "test-secret-key-chat-gw";
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeAll(async () => {
    gateway = await startGateway({
      port: 0,
      logger,
      apiKey: TEST_API_KEY,
      projectPath: "/tmp",
      webUI: true,
      statusTracker: {
        getAllAgents: () => [],
        getSchedulerInfo: () => ({}),
        getRecentLogs: () => [],
        getInstances: () => [],
        on: vi.fn(),
        removeListener: vi.fn(),
      } as any,
    });
    const addr = gateway.server.address() as any;
    baseUrl = `http://localhost:${addr.port}`;
  });

  afterAll(async () => {
    await gateway.close();
  });

  it("exposes ChatSessionManager", () => {
    expect(gateway.chatSessionManager).toBeDefined();
    expect(gateway.chatSessionManager.size).toBe(0);
  });

  it("protects /api/chat/sessions with auth", async () => {
    // Without auth
    const res = await fetch(`${baseUrl}/api/chat/sessions`);
    expect(res.status).toBe(401);

    // With auth
    const res2 = await fetch(`${baseUrl}/api/chat/sessions`, {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    expect(res2.status).toBe(200);
    const body = await res2.json();
    expect(body.sessions).toEqual([]);
  });

  it("creates and lists chat sessions via REST", async () => {
    const headers = {
      Authorization: `Bearer ${TEST_API_KEY}`,
      "Content-Type": "application/json",
    };

    // Create session
    const createRes = await fetch(`${baseUrl}/api/chat/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ agentName: "test-agent" }),
    });
    expect(createRes.status).toBe(200);
    const { sessionId } = await createRes.json();
    expect(sessionId).toBeTruthy();

    // List sessions
    const listRes = await fetch(`${baseUrl}/api/chat/sessions`, { headers });
    const { sessions } = await listRes.json();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].agentName).toBe("test-agent");
    expect(sessions[0].sessionId).toBe(sessionId);

    // Delete session
    const deleteRes = await fetch(`${baseUrl}/api/chat/sessions/${sessionId}`, {
      method: "DELETE",
      headers,
    });
    expect(deleteRes.status).toBe(200);

    // Verify deleted
    const listRes2 = await fetch(`${baseUrl}/api/chat/sessions`, { headers });
    const { sessions: remaining } = await listRes2.json();
    expect(remaining).toHaveLength(0);
  });

  it("rejects session creation without agentName", async () => {
    const res = await fetch(`${baseUrl}/api/chat/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for deleting unknown session", async () => {
    const res = await fetch(`${baseUrl}/api/chat/sessions/nonexistent`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    expect(res.status).toBe(404);
  });

  it("enforces maxChatSessions limit", async () => {
    // Default is 5, create 5 sessions
    const headers = {
      Authorization: `Bearer ${TEST_API_KEY}`,
      "Content-Type": "application/json",
    };

    const sessionIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/api/chat/sessions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ agentName: `agent-${i}` }),
      });
      expect(res.status).toBe(200);
      const { sessionId } = await res.json();
      sessionIds.push(sessionId);
    }

    // 6th should fail
    const res = await fetch(`${baseUrl}/api/chat/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ agentName: "overflow" }),
    });
    expect(res.status).toBe(429);

    // Clean up
    for (const id of sessionIds) {
      await fetch(`${baseUrl}/api/chat/sessions/${id}`, {
        method: "DELETE",
        headers,
      });
    }
  });
});
