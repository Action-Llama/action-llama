/**
 * Container entrypoint for chat mode.
 *
 * When AL_CHAT_MODE=1 is set, this module is loaded instead of the normal
 * agent runner. It starts an RPC client and bridges it to the gateway via WS.
 */

import WebSocket from "ws";
import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  createCodingTools,
} from "@mariozechner/pi-coding-agent";
import type { AgentInit } from "./container-entry.js";
import { loadContainerCredentials } from "./credential-setup.js";
import { mapAgentEvent } from "../chat/event-mapper.js";
import type { ChatInbound, ChatOutbound } from "../chat/types.js";

function emitLog(level: string, msg: string, data?: Record<string, any>) {
  console.log(JSON.stringify({ _log: true, level, msg, ...data, ts: Date.now() }));
}

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const HEARTBEAT_INTERVAL_MS = 30_000;

export async function runChatMode(init: AgentInit): Promise<number> {
  const { agentConfig, resourceLoader, settingsManager } = init;

  emitLog("info", "chat mode starting", { agentName: agentConfig.name });

  // Load credentials
  const { providerKeys } = loadContainerCredentials(agentConfig);

  // Resolve model
  const primaryModel = agentConfig.models[0];
  const providerKey = providerKeys.get(primaryModel.provider);

  const authStorage = AuthStorage.create();
  if (providerKey) {
    authStorage.setRuntimeApiKey(primaryModel.provider, providerKey);
  }

  const model = getModel(primaryModel.provider as any, primaryModel.model as any);
  const cwd = "/app/static";

  // Create agent session
  const { session } = await createAgentSession({
    cwd,
    model,
    thinkingLevel: primaryModel.thinkingLevel,
    authStorage,
    resourceLoader,
    tools: createCodingTools(cwd, {
      bash: { commandPrefix: '[ -f /tmp/env.sh ] && source /tmp/env.sh' },
    }),
    sessionManager: SessionManager.inMemory(),
    settingsManager,
  });

  // Connect to gateway WS
  const gatewayUrl = process.env.GATEWAY_URL;
  const sessionId = process.env.AL_CHAT_SESSION_ID;
  if (!gatewayUrl || !sessionId) {
    throw new Error("GATEWAY_URL and AL_CHAT_SESSION_ID required for chat mode");
  }

  const wsUrl = `${gatewayUrl.replace(/^http/, "ws")}/chat/container/${sessionId}`;
  emitLog("info", "connecting to gateway", { wsUrl });

  const ws = new WebSocket(wsUrl);

  let agentBusy = false;
  let lastActivity = Date.now();

  // Idle timeout — self-terminate after 15min
  const idleCheck = setInterval(() => {
    if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
      emitLog("info", "idle timeout reached, shutting down");
      cleanup();
      process.exit(0);
    }
  }, 60_000);
  idleCheck.unref();

  // Heartbeat
  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      const msg: ChatOutbound = { type: "heartbeat" };
      ws.send(JSON.stringify(msg));
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  function cleanup() {
    clearInterval(idleCheck);
    clearInterval(heartbeat);
    session.dispose();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }

  // Subscribe to session events and forward them
  session.subscribe((event) => {
    const outbound = mapAgentEvent(event as any);
    for (const msg of outbound) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
      // When agent finishes a turn, mark it as not busy
      if (msg.type === "assistant_message" && msg.done) {
        agentBusy = false;
      }
    }
  });

  return new Promise<number>((resolve) => {
    ws.on("open", () => {
      emitLog("info", "WebSocket connected, authenticating");
      // Authenticate with session ID as token
      ws.send(JSON.stringify({ type: "auth", token: sessionId }));
    });

    ws.on("message", (data) => {
      const raw = data.toString();
      lastActivity = Date.now();

      let msg: any;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      // Auth acknowledgement
      if (msg.type === "auth_ok") {
        emitLog("info", "authenticated with gateway");
        return;
      }

      handleInbound(msg as ChatInbound);
    });

    ws.on("close", () => {
      emitLog("info", "WebSocket closed, exiting");
      cleanup();
      resolve(0);
    });

    ws.on("error", (err) => {
      emitLog("error", "WebSocket error", { error: err.message });
      cleanup();
      resolve(1);
    });

    function handleInbound(msg: ChatInbound) {
      switch (msg.type) {
        case "user_message":
          if (agentBusy) {
            // Steer the agent (provide additional input during a turn)
            // PI doesn't have a steer API yet, so we queue it as a new prompt
            // after the current one completes. For now, send error.
            const errMsg: ChatOutbound = { type: "error", message: "Agent is busy processing. Please wait." };
            ws.send(JSON.stringify(errMsg));
          } else {
            agentBusy = true;
            session.prompt(msg.text).catch((err: any) => {
              emitLog("error", "prompt error", { error: err.message });
              const errMsg: ChatOutbound = { type: "error", message: err.message };
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(errMsg));
              }
              agentBusy = false;
            });
          }
          break;

        case "cancel":
          if (agentBusy) {
            session.dispose();
            agentBusy = false;
            emitLog("info", "cancelled current prompt");
          }
          break;

        case "shutdown":
          emitLog("info", "shutdown requested");
          cleanup();
          resolve(0);
          break;
      }
    }
  });
}
