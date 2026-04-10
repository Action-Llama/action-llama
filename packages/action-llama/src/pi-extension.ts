/**
 * Action Llama Pi extension — /sessions and /attach commands.
 *
 * Provides interactive session listing and attachment to running
 * Action Llama agent sessions via the gateway WebSocket attach protocol.
 *
 * Load with: pi -e @action-llama/action-llama/extension
 */

import type { ExtensionFactory, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { TUI, Component } from "@mariozechner/pi-tui";
import WebSocket from "ws";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { resolve, join } from "path";
import { parse as parseToml } from "smol-toml";

// ─── Gateway discovery ────────────────────────────────────────────────────────

interface GatewayConfig {
  gatewayUrl: string;
  apiKey: string | undefined;
}

function discoverGateway(cwd: string, gatewayOverride?: string): GatewayConfig {
  // Read gateway port from config.toml
  let port = 8080;
  const configPath = join(cwd, "config.toml");
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf8");
      const cfg = parseToml(raw) as any;
      if (cfg?.gateway?.port) port = Number(cfg.gateway.port);
    } catch {}
  }

  const gatewayUrl = gatewayOverride ?? `http://localhost:${port}`;

  // Read API key from credential store
  const keyPath = join(
    process.env.AL_CREDENTIALS_DIR ?? join(homedir(), ".action-llama", "credentials"),
    "gateway_api_key", "default", "key",
  );
  const apiKey = existsSync(keyPath) ? readFileSync(keyPath, "utf8").trim() : undefined;

  return { gatewayUrl, apiKey };
}

// ─── Session type ─────────────────────────────────────────────────────────────

interface SessionInfo {
  id: string;
  agentName: string;
  status: string;
  startedAt: string;
  trigger: string;
}

// ─── AttachView — full-takeover TUI component ─────────────────────────────────

class AttachView implements Component {
  private lines: string[] = [];
  private inputBuffer = "";
  private closed = false;

  constructor(
    private readonly tui: TUI,
    private readonly ws: WebSocket,
    private readonly done: (result: void) => void,
    private readonly sessionId: string,
  ) {}

  addLine(text: string): void {
    this.lines.push(text);
    if (!this.closed) this.tui.invalidate();
  }

  close(): void {
    this.closed = true;
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
    this.done(undefined);
  }

  render(width: number): string[] {
    const bar = "─".repeat(width);
    const rows = this.tui.terminal.rows;
    const out: string[] = [];

    // Header
    out.push(bar);
    const header = ` Attached: ${this.sessionId}   Enter=steer  Esc=detach  Ctrl+C=abort `;
    out.push(header.slice(0, width));
    out.push(bar);

    // Transcript — fill available space
    const inputRows = 2;
    const maxContent = Math.max(0, rows - out.length - inputRows - 1);
    const slice = this.lines.slice(-maxContent);
    for (const l of slice) {
      out.push(l.length > width ? l.slice(0, width) : l);
    }

    // Input area
    out.push(bar);
    const inputLine = ` > ${this.inputBuffer}`;
    out.push(inputLine.slice(0, width));

    return out;
  }

  handleInput(data: string): void {
    if (this.closed) return;

    if (data === "\x03") {
      // Ctrl+C — send abort, then detach
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "abort" }) + "\n");
      }
      this.addLine("  [abort sent]");
      this.close();
      return;
    }

    if (data === "\x1b") {
      // Escape — detach
      this.close();
      return;
    }

    if (data === "\r" || data === "\n") {
      // Enter — send steer
      const msg = this.inputBuffer.trim();
      if (msg && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "steer", message: msg }) + "\n");
        this.addLine(`  > ${msg}`);
      }
      this.inputBuffer = "";
      this.tui.invalidate();
      return;
    }

    if (data === "\x7f" || data === "\b") {
      // Backspace
      this.inputBuffer = this.inputBuffer.slice(0, -1);
      this.tui.invalidate();
      return;
    }

    // Printable character
    if (data.length === 1 && data >= " ") {
      this.inputBuffer += data;
      this.tui.invalidate();
    }
  }

  invalidate(): void {
    // No cached state
  }
}

// ─── Attach logic ─────────────────────────────────────────────────────────────

async function handleAttach(
  sessionId: string,
  gatewayUrl: string,
  apiKey: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const wsUrl = gatewayUrl.replace(/^http/, "ws") + `/sessions/${sessionId}/attach`;

  const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${apiKey}` } });

  // Wait for WebSocket to open (or fail)
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
    setTimeout(() => reject(new Error("WebSocket connection timeout")), 10_000);
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.ui.notify(`Could not connect to session: ${msg}`, "error");
    return null;
  }).then((r) => {
    if (r === null) { ws.terminate(); return; }
  });

  if (ws.readyState !== WebSocket.OPEN) return;

  await ctx.ui.custom<void>(
    async (tui, _theme, _keybindings, done) => {
      const view = new AttachView(tui, ws, done, sessionId);
      view.addLine(`  Connecting to session ${sessionId}...`);

      let buffer = "";

      ws.on("message", (raw: Buffer | string) => {
        const text = typeof raw === "string" ? raw : raw.toString("utf8");
        buffer += text;

        // Process complete JSONL lines
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line) continue;
          try {
            const event = JSON.parse(line);
            handleEvent(event, view);
          } catch {
            // Ignore malformed lines
          }
        }
      });

      ws.on("close", () => {
        if (!view["closed"]) {
          view.addLine("  [connection closed]");
          // Give the user a moment to read the message
          setTimeout(() => view.close(), 1500);
        }
      });

      ws.on("error", (err: Error) => {
        view.addLine(`  [connection error: ${err.message}]`);
        setTimeout(() => view.close(), 1500);
      });

      return view;
    },
    { overlay: false },
  );

  // Cleanup if custom() returned without close() being called
  if (ws.readyState === WebSocket.OPEN) ws.close();
}

function handleEvent(event: any, view: AttachView): void {
  if (!event?.type) return;

  if (event.type === "state_snapshot") {
    const state = event.state;
    if (!state?.messages?.length) {
      view.addLine("  [no messages yet]");
      return;
    }
    view.addLine("  ─── Session transcript ───");
    for (const msg of state.messages) {
      renderMessage(msg, view);
    }
    view.addLine("  ─── Live ───");
    return;
  }

  if (event.type === "agent_end") {
    view.addLine("  [session ended]");
    setTimeout(() => view.close(), 1000);
    return;
  }

  if (event.type === "error") {
    view.addLine(`  [error: ${event.message ?? JSON.stringify(event)}]`);
    return;
  }

  if (event.type === "message_update") {
    const ame = event.assistantMessageEvent;
    if (ame?.type === "text_delta" && ame.delta) {
      // Accumulate into the last line if it's a text continuation
      view.addLine(`  ${ame.delta}`);
    }
    return;
  }

  if (event.type === "turn_end") {
    view.addLine("");
    return;
  }

  if (event.type === "tool_execution_start") {
    view.addLine(`  [${event.toolName}] ${JSON.stringify(event.args ?? {}).slice(0, 120)}`);
    return;
  }

  if (event.type === "tool_execution_end" && event.isError) {
    view.addLine(`  [error in ${event.toolName}]`);
    return;
  }
}

function renderMessage(msg: any, view: AttachView): void {
  if (msg.role === "user") {
    const text = extractText(msg.content);
    if (text) view.addLine(`  User: ${text.slice(0, 200)}`);
  } else if (msg.role === "assistant") {
    const text = extractText(msg.content);
    if (text) view.addLine(`  Agent: ${text.slice(0, 200)}`);
  }
}

function extractText(content: any): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c.type === "text" && c.text)
      .map((c: any) => String(c.text).trim())
      .join(" ");
  }
  return "";
}

// ─── Extension factory ────────────────────────────────────────────────────────

const alExtension: ExtensionFactory = (pi) => {
  pi.registerFlag("gateway", {
    description: "Override gateway URL (e.g. http://localhost:8080)",
    type: "string",
  });

  pi.registerCommand("sessions", {
    description: "List active Action Llama agent sessions and attach to one",
    handler: async (_args, ctx) => {
      const { gatewayUrl, apiKey } = discoverGateway(
        ctx.cwd,
        pi.getFlag("gateway") as string | undefined,
      );

      if (!apiKey) {
        ctx.ui.notify("No gateway API key found. Run 'al doctor' to set up.", "error");
        return;
      }

      let sessions: SessionInfo[];
      try {
        const res = await fetch(`${gatewayUrl}/sessions`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) {
          ctx.ui.notify(`Gateway returned ${res.status} — is 'al start' running?`, "error");
          return;
        }
        const data = await res.json() as { sessions: SessionInfo[] };
        sessions = data.sessions;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Gateway unreachable: ${msg}`, "error");
        return;
      }

      if (sessions.length === 0) {
        ctx.ui.notify("No active sessions.", "info");
        return;
      }

      const labels = sessions.map(
        s => `${s.agentName}  [${s.status}]  ${s.trigger}  ${s.id}`,
      );
      const chosen = await ctx.ui.select("Attach to session:", labels);
      if (!chosen) return;

      const idx = labels.indexOf(chosen);
      if (idx < 0) return;

      await handleAttach(sessions[idx].id, gatewayUrl, apiKey, ctx);
    },
  });

  pi.registerCommand("attach", {
    description: "Attach to a running Action Llama session by ID",
    handler: async (args, ctx) => {
      const sessionId = args.trim();
      if (!sessionId) {
        ctx.ui.notify("Usage: /attach <session-id>", "error");
        return;
      }

      const { gatewayUrl, apiKey } = discoverGateway(
        ctx.cwd,
        pi.getFlag("gateway") as string | undefined,
      );

      if (!apiKey) {
        ctx.ui.notify("No gateway API key found. Run 'al doctor' to set up.", "error");
        return;
      }

      await handleAttach(sessionId, gatewayUrl, apiKey, ctx);
    },
  });
};

export default alExtension;
