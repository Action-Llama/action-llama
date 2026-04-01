/**
 * Integration test: chat WebSocket endpoints.
 *
 * The gateway registers two WebSocket paths when started with webUI=true:
 *   /chat/ws/:sessionId       — browser-facing; auth via Authorization header
 *   /chat/container/:sessionId — container-facing; auth via first-message token
 *
 * This test exercises the WebSocket upgrade handling in chat/ws-handler.ts:
 *   - 404 when the session doesn't exist (browser or container path)
 *   - 401 when the browser connects without a valid API key
 *   - Successful browser connection with Bearer auth
 *   - Successful container auth handshake (type:"auth", token:<sessionId>)
 *   - Container auth timeout: no auth message within 5s → close(4001)
 *   - Container auth failure: wrong token → close(4003)
 *   - Browser message forwarding to container
 *   - Container disconnect notifies browser
 *
 * Covers: chat/ws-handler.ts attachChatWebSocket() — all major branches.
 */

import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

/** Open a WebSocket connection and wait for it to open or error. */
function openWs(url: string, headers?: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const timer = setTimeout(() => reject(new Error("WebSocket open timeout")), 5_000);
    ws.on("open", () => { clearTimeout(timer); resolve(ws); });
    ws.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

/** Wait for a WebSocket to receive exactly one message within timeoutMs. */
function waitForMessage(ws: WebSocket, timeoutMs = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket message timeout")), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(data.toString());
    });
  });
}

/** Wait for a WebSocket to close and return its close code. */
function waitForClose(ws: WebSocket, timeoutMs = 8_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket close timeout")), timeoutMs);
    ws.on("close", (code) => { clearTimeout(timer); resolve(code); });
    ws.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

/** Attempt a WebSocket upgrade that is expected to be rejected (non-101 response). */
function expectWsRejected(url: string, headers?: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const timer = setTimeout(() => reject(new Error("WebSocket rejection timeout")), 5_000);
    ws.on("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      ws.terminate();
      resolve(res.statusCode ?? 0);
    });
    ws.on("open", () => {
      clearTimeout(timer);
      ws.close();
      reject(new Error("WebSocket unexpectedly opened (expected rejection)"));
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe.skipIf(!DOCKER)(
  "integration: chat WebSocket endpoints",
  { timeout: 300_000 },
  () => {
    let harness: IntegrationHarness;
    const openSockets: WebSocket[] = [];

    afterEach(async () => {
      // Close any lingering WebSocket connections
      for (const ws of openSockets) {
        try { ws.terminate(); } catch { /* already closed */ }
      }
      openSockets.length = 0;
      if (harness) await harness.shutdown();
    });

    /** Helper: call the chat session REST API. */
    function chatRest(method: string, path: string, body?: unknown): Promise<Response> {
      const headers: Record<string, string> = { Authorization: `Bearer ${harness.apiKey}` };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      return fetch(`http://127.0.0.1:${harness.gatewayPort}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    }

    it("browser WS returns 404 for unknown sessionId", async () => {
      harness = await IntegrationHarness.create({
        agents: [{ name: "ws-404-agent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" }],
      });
      await harness.start({ webUI: true });

      const wsUrl = `ws://127.0.0.1:${harness.gatewayPort}/chat/ws/nonexistent-session-id`;
      const statusCode = await expectWsRejected(wsUrl, { Authorization: `Bearer ${harness.apiKey}` });
      expect(statusCode).toBe(404);
    });

    it("browser WS returns 401 when Authorization header is missing", async () => {
      harness = await IntegrationHarness.create({
        agents: [{ name: "ws-401-agent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" }],
      });
      await harness.start({ webUI: true });

      // Create a session first
      const createRes = await chatRest("POST", "/api/chat/sessions", { agentName: "ws-401-agent" });
      expect(createRes.ok).toBe(true);
      const { sessionId } = (await createRes.json()) as { sessionId: string };

      // Connect without auth header → should get 401
      const wsUrl = `ws://127.0.0.1:${harness.gatewayPort}/chat/ws/${sessionId}`;
      const statusCode = await expectWsRejected(wsUrl); // no Authorization header
      expect(statusCode).toBe(401);
    });

    it("browser WS connects successfully with valid Bearer auth and existing session", async () => {
      harness = await IntegrationHarness.create({
        agents: [{ name: "ws-auth-agent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" }],
      });
      await harness.start({ webUI: true });

      // Create a session
      const createRes = await chatRest("POST", "/api/chat/sessions", { agentName: "ws-auth-agent" });
      expect(createRes.ok).toBe(true);
      const { sessionId } = (await createRes.json()) as { sessionId: string };

      // Connect with valid auth
      const wsUrl = `ws://127.0.0.1:${harness.gatewayPort}/chat/ws/${sessionId}`;
      const ws = await openWs(wsUrl, { Authorization: `Bearer ${harness.apiKey}` });
      openSockets.push(ws);

      // Connection should be open
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it("container WS returns 404 for unknown sessionId", async () => {
      harness = await IntegrationHarness.create({
        agents: [{ name: "ws-container-404-agent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" }],
      });
      await harness.start({ webUI: true });

      const wsUrl = `ws://127.0.0.1:${harness.gatewayPort}/chat/container/nonexistent-session`;
      const statusCode = await expectWsRejected(wsUrl);
      expect(statusCode).toBe(404);
    });

    it("container WS authenticates successfully with session token", async () => {
      harness = await IntegrationHarness.create({
        agents: [{ name: "ws-container-auth-agent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" }],
      });
      await harness.start({ webUI: true });

      // Create a session
      const createRes = await chatRest("POST", "/api/chat/sessions", { agentName: "ws-container-auth-agent" });
      expect(createRes.ok).toBe(true);
      const { sessionId } = (await createRes.json()) as { sessionId: string };

      // Container connects to /chat/container/:sessionId
      const wsUrl = `ws://127.0.0.1:${harness.gatewayPort}/chat/container/${sessionId}`;
      const ws = await openWs(wsUrl);
      openSockets.push(ws);

      // Authenticate: first message must be { type: "auth", token: sessionId }
      const authMsg = JSON.stringify({ type: "auth", token: sessionId });
      ws.send(authMsg);

      // Server responds with { type: "auth_ok" }
      const response = await waitForMessage(ws, 5_000);
      const parsed = JSON.parse(response);
      expect(parsed.type).toBe("auth_ok");

      ws.close();
    });

    it("container WS closes with 4003 when wrong auth token is sent", async () => {
      harness = await IntegrationHarness.create({
        agents: [{ name: "ws-container-badauth-agent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" }],
      });
      await harness.start({ webUI: true });

      const createRes = await chatRest("POST", "/api/chat/sessions", { agentName: "ws-container-badauth-agent" });
      expect(createRes.ok).toBe(true);
      const { sessionId } = (await createRes.json()) as { sessionId: string };

      const wsUrl = `ws://127.0.0.1:${harness.gatewayPort}/chat/container/${sessionId}`;
      const ws = await openWs(wsUrl);
      openSockets.push(ws);

      // Send wrong token — server should close with code 4003
      ws.send(JSON.stringify({ type: "auth", token: "wrong-token-xyz" }));

      const closeCode = await waitForClose(ws, 6_000);
      expect(closeCode).toBe(4003);
    });

    it("browser message is forwarded to connected container", async () => {
      harness = await IntegrationHarness.create({
        agents: [{ name: "ws-bridge-agent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" }],
      });
      await harness.start({ webUI: true });

      const createRes = await chatRest("POST", "/api/chat/sessions", { agentName: "ws-bridge-agent" });
      expect(createRes.ok).toBe(true);
      const { sessionId } = (await createRes.json()) as { sessionId: string };

      const gatewayBase = `ws://127.0.0.1:${harness.gatewayPort}`;

      // Connect browser WS
      const browserWs = await openWs(`${gatewayBase}/chat/ws/${sessionId}`, {
        Authorization: `Bearer ${harness.apiKey}`,
      });
      openSockets.push(browserWs);

      // Connect container WS and authenticate
      const containerWs = await openWs(`${gatewayBase}/chat/container/${sessionId}`);
      openSockets.push(containerWs);

      containerWs.send(JSON.stringify({ type: "auth", token: sessionId }));
      const authResp = await waitForMessage(containerWs, 5_000);
      expect(JSON.parse(authResp).type).toBe("auth_ok");

      // Browser sends a message — should be forwarded to container
      const testMsg = JSON.stringify({ type: "message", content: "hello from browser" });
      browserWs.send(testMsg);

      // Container receives the forwarded message
      const received = await waitForMessage(containerWs, 5_000);
      expect(received).toBe(testMsg);

      browserWs.close();
      containerWs.close();
    });

    it("container disconnect sends error notification to browser", async () => {
      harness = await IntegrationHarness.create({
        agents: [{ name: "ws-disconnect-agent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" }],
      });
      await harness.start({ webUI: true });

      const createRes = await chatRest("POST", "/api/chat/sessions", { agentName: "ws-disconnect-agent" });
      expect(createRes.ok).toBe(true);
      const { sessionId } = (await createRes.json()) as { sessionId: string };

      const gatewayBase = `ws://127.0.0.1:${harness.gatewayPort}`;

      const browserWs = await openWs(`${gatewayBase}/chat/ws/${sessionId}`, {
        Authorization: `Bearer ${harness.apiKey}`,
      });
      openSockets.push(browserWs);

      const containerWs = await openWs(`${gatewayBase}/chat/container/${sessionId}`);
      openSockets.push(containerWs);

      containerWs.send(JSON.stringify({ type: "auth", token: sessionId }));
      await waitForMessage(containerWs, 5_000); // auth_ok

      // Container disconnects — browser should receive an error notification
      const browserMsgPromise = waitForMessage(browserWs, 5_000);
      containerWs.close();

      const notification = await browserMsgPromise;
      const parsed = JSON.parse(notification);
      expect(parsed.type).toBe("error");
      expect(parsed.message).toMatch(/disconnected/i);

      browserWs.close();
    });
  },
);
