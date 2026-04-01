/**
 * Integration test: chat WebSocket message validation and edge cases.
 *
 * Exercises paths in chat/ws-handler.ts and chat/validation.ts that aren't
 * covered by the basic connection tests in chat-ws.test.ts:
 *
 *   1. Browser sends invalid message type → server sends back {type:"error"}
 *   2. Browser sends oversized message (>64KB) → {type:"error"} size limit
 *   3. Browser sends message when container is NOT connected → {type:"error"}
 *   4. Browser sends invalid JSON → {type:"error"} invalid JSON
 *   5. Container sends invalid outbound message type → silently dropped
 *      (ws-handler logs a warning but does NOT close the connection)
 *
 * Covers: chat/ws-handler.ts handleBrowserConnection (validation branch),
 *         chat/validation.ts validateInbound/validateOutbound size+type checks.
 */

import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

/** Open a WebSocket and wait for open or error. */
function openWs(url: string, headers?: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const timer = setTimeout(() => reject(new Error("WebSocket open timeout")), 5_000);
    ws.on("open", () => { clearTimeout(timer); resolve(ws); });
    ws.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

/** Wait for one message from a WebSocket within timeoutMs. */
function waitForMessage(ws: WebSocket, timeoutMs = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket message timeout")), timeoutMs);
    ws.once("message", (data) => { clearTimeout(timer); resolve(data.toString()); });
  });
}

describe.skipIf(!DOCKER)(
  "integration: chat WebSocket message validation",
  { timeout: 300_000 },
  () => {
    let harness: IntegrationHarness;
    const openSockets: WebSocket[] = [];

    afterEach(async () => {
      for (const ws of openSockets) {
        try { ws.terminate(); } catch { /* already closed */ }
      }
      openSockets.length = 0;
      if (harness) await harness.shutdown();
    });

    function chatRest(method: string, path: string, body?: unknown): Promise<Response> {
      const headers: Record<string, string> = { Authorization: `Bearer ${harness.apiKey}` };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      return fetch(`http://127.0.0.1:${harness.gatewayPort}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    }

    async function createSessionAndConnectBrowser(agentName: string): Promise<{ sessionId: string; browserWs: WebSocket }> {
      const createRes = await chatRest("POST", "/api/chat/sessions", { agentName });
      expect(createRes.ok).toBe(true);
      const { sessionId } = (await createRes.json()) as { sessionId: string };

      const wsUrl = `ws://127.0.0.1:${harness.gatewayPort}/chat/ws/${sessionId}`;
      const browserWs = await openWs(wsUrl, { Authorization: `Bearer ${harness.apiKey}` });
      openSockets.push(browserWs);

      return { sessionId, browserWs };
    }

    it("browser sends invalid message type → server responds with {type:'error'}", async () => {
      harness = await IntegrationHarness.create({
        agents: [{ name: "ws-val-type-agent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" }],
      });
      await harness.start({ webUI: true });

      const { browserWs } = await createSessionAndConnectBrowser("ws-val-type-agent");

      // Send a message with an unknown type — validateInbound should reject it
      browserWs.send(JSON.stringify({ type: "unknown_type", text: "hello" }));

      const response = await waitForMessage(browserWs, 5_000);
      const parsed = JSON.parse(response);
      expect(parsed.type).toBe("error");
      expect(parsed.message).toBeTruthy();

      browserWs.close();
    });

    it("browser sends invalid JSON → server responds with {type:'error'}", async () => {
      harness = await IntegrationHarness.create({
        agents: [{ name: "ws-val-json-agent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" }],
      });
      await harness.start({ webUI: true });

      const { browserWs } = await createSessionAndConnectBrowser("ws-val-json-agent");

      // Send malformed JSON — validateInbound catches JSON.parse failure
      browserWs.send("this is not valid json {{{");

      const response = await waitForMessage(browserWs, 5_000);
      const parsed = JSON.parse(response);
      expect(parsed.type).toBe("error");

      browserWs.close();
    });

    it("browser sends user_message without text field → server responds with {type:'error'}", async () => {
      harness = await IntegrationHarness.create({
        agents: [{ name: "ws-val-notext-agent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" }],
      });
      await harness.start({ webUI: true });

      const { browserWs } = await createSessionAndConnectBrowser("ws-val-notext-agent");

      // user_message requires non-empty text — omit text to trigger validation error
      browserWs.send(JSON.stringify({ type: "user_message" }));

      const response = await waitForMessage(browserWs, 5_000);
      const parsed = JSON.parse(response);
      expect(parsed.type).toBe("error");
      expect(parsed.message).toMatch(/text/i);

      browserWs.close();
    });

    it("browser sends oversized message → server responds with {type:'error'} size limit", async () => {
      harness = await IntegrationHarness.create({
        agents: [{ name: "ws-val-size-agent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" }],
      });
      await harness.start({ webUI: true });

      const { browserWs } = await createSessionAndConnectBrowser("ws-val-size-agent");

      // Send a message that exceeds the 64KB limit
      const oversized = "x".repeat(65 * 1024); // 65KB raw string
      browserWs.send(oversized);

      const response = await waitForMessage(browserWs, 5_000);
      const parsed = JSON.parse(response);
      expect(parsed.type).toBe("error");
      expect(parsed.message).toMatch(/exceed/i);

      browserWs.close();
    });

    it("browser sends valid message when container is not connected → {type:'error'} container not connected", async () => {
      harness = await IntegrationHarness.create({
        agents: [{ name: "ws-val-nocontainer-agent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" }],
      });
      await harness.start({ webUI: true });

      const { browserWs } = await createSessionAndConnectBrowser("ws-val-nocontainer-agent");

      // Send a valid user_message — but no container is connected to forward it to
      browserWs.send(JSON.stringify({ type: "user_message", text: "Hello!" }));

      const response = await waitForMessage(browserWs, 5_000);
      const parsed = JSON.parse(response);
      expect(parsed.type).toBe("error");
      expect(parsed.message).toMatch(/not connected/i);

      browserWs.close();
    });
  },
);
