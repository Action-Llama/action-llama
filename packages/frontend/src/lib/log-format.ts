/**
 * Shared log formatting for both CLI (ANSI) and web UI (CSS).
 *
 * This module provides a pure function that takes a pino log entry and returns
 * a structured representation that both renderers can consume. The CLI maps
 * prefixes to ANSI colors; the frontend maps them to Tailwind classes.
 */

export interface LogEntry {
  level: number;
  time: number;
  msg: string;
  instance?: string;
  [key: string]: unknown;
}

export type LogPrefix =
  | "tool"       // tool call start
  | "result"     // tool call result
  | "error"      // tool error or general error
  | "thinking"   // LLM thinking/reasoning
  | "text"       // LLM text output
  | "run"        // run lifecycle (start, outcome)
  | "warn"       // warnings (rate limit, etc.)
  | "debug";     // debug-level catch-all

export interface FormattedLogLine {
  timestamp: number;
  prefix: LogPrefix;
  label: string | null;   // tool name for tool/result/error; null for text/thinking/run
  body: string;
  level: "info" | "warn" | "error" | "debug";
  instance?: string;
}

/**
 * Format a pino log entry into a structured log line.
 * Returns null if the entry should be hidden at the current display level.
 *
 * @param entry - A parsed pino log entry
 * @param showDebug - If true, include debug-level entries (default: false)
 */
export function formatLogEntry(entry: LogEntry, showDebug = false): FormattedLogLine | null {
  const { msg, level } = entry;

  // ── Prefix-based messages (new format from transport-runner) ────────

  if (msg === "[tool]") {
    return {
      timestamp: entry.time,
      prefix: "tool",
      label: str(entry.toolName),
      body: str(entry.summary),
      level: "info",
      instance: entry.instance,
    };
  }

  if (msg === "[result]") {
    return {
      timestamp: entry.time,
      prefix: "result",
      label: str(entry.toolName),
      body: str(entry.summary),
      level: "info",
      instance: entry.instance,
    };
  }

  if (msg === "[error]" || msg === "tool error") {
    return {
      timestamp: entry.time,
      prefix: "error",
      label: str(entry.toolName) || null,
      body: str(entry.error || entry.summary || msg),
      level: "error",
      instance: entry.instance,
    };
  }

  if (msg === "[thinking]") {
    return {
      timestamp: entry.time,
      prefix: "thinking",
      label: null,
      body: str(entry.text),
      level: "info",
      instance: entry.instance,
    };
  }

  if (msg === "[text]") {
    return {
      timestamp: entry.time,
      prefix: "text",
      label: null,
      body: str(entry.text),
      level: "info",
      instance: entry.instance,
    };
  }

  // ── Run lifecycle ──────────────────────────────────────────────────

  if (msg === "run outcome") {
    const result = str(entry.result);
    const elapsed = str(entry.elapsed);
    const tokens = entry.inputTokens != null && entry.outputTokens != null
      ? `${Number(entry.inputTokens) + Number(entry.outputTokens)} tokens`
      : entry.totalTokens != null ? `${entry.totalTokens} tokens` : "";
    const turns = entry.turnCount != null ? `${entry.turnCount} turns` : "";
    const cost = entry.cost != null ? `$${Number(entry.cost).toFixed(4)}` : "";
    const meta = [elapsed, tokens, turns, cost].filter(Boolean).join(", ");
    const errStr = entry.error ? ` — ${str(entry.error).slice(0, 300)}` : "";
    return {
      timestamp: entry.time,
      prefix: "run",
      label: null,
      body: `${result}${meta ? ` (${meta})` : ""}${errStr}`,
      level: result === "error" ? "error" : "info",
      instance: entry.instance,
    };
  }

  if (msg.startsWith("Starting ") && msg.includes("transport run")) {
    return {
      timestamp: entry.time,
      prefix: "run",
      label: null,
      body: msg,
      level: "info",
      instance: entry.instance,
    };
  }

  if (msg === "session completed") {
    const turns = entry.turnCount != null ? `${entry.turnCount} turns` : "";
    const cost = entry.cost != null ? `$${Number(entry.cost).toFixed(4)}` : "";
    const tokens = entry.inputTokens != null && entry.outputTokens != null
      ? `${Number(entry.inputTokens) + Number(entry.outputTokens)} tokens`
      : "";
    const meta = [tokens, turns, cost].filter(Boolean).join(", ");
    return {
      timestamp: entry.time,
      prefix: "run",
      label: null,
      body: `session completed${meta ? ` (${meta})` : ""}`,
      level: "info",
      instance: entry.instance,
    };
  }

  // ── Warnings ───────────────────────────────────────────────────────

  if (msg === "rate limited, trying next model") {
    const provider = str(entry.provider);
    const model = str(entry.model);
    return {
      timestamp: entry.time,
      prefix: "warn",
      label: null,
      body: `Rate limited ${provider}/${model} — trying next model`,
      level: "warn",
      instance: entry.instance,
    };
  }

  if (msg.includes("all models exhausted")) {
    return {
      timestamp: entry.time,
      prefix: "error",
      label: null,
      body: msg,
      level: "error",
      instance: entry.instance,
    };
  }

  // ── Errors (level >= 50) ───────────────────────────────────────────

  if (level >= 50) {
    const errDetail = str(entry.error || entry.err || "");
    const body = errDetail ? `${msg} — ${errDetail.slice(0, 300)}` : msg;
    return {
      timestamp: entry.time,
      prefix: "error",
      label: null,
      body,
      level: "error",
      instance: entry.instance,
    };
  }

  // ── Warnings (level >= 40) ─────────────────────────────────────────

  if (level >= 40) {
    const detail = str(entry.error || entry.text || "");
    const body = detail ? `${msg} — ${detail.slice(0, 300)}` : msg;
    return {
      timestamp: entry.time,
      prefix: "warn",
      label: null,
      body,
      level: "warn",
      instance: entry.instance,
    };
  }

  // ── Debug-level catch-all ──────────────────────────────────────────

  if (level <= 20) {
    if (!showDebug) return null;
    return {
      timestamp: entry.time,
      prefix: "debug",
      label: null,
      body: msg,
      level: "debug",
      instance: entry.instance,
    };
  }

  // ── Info-level catch-all (infrastructure messages demoted by caller) ─

  return {
    timestamp: entry.time,
    prefix: "debug",
    label: null,
    body: msg,
    level: "info",
    instance: entry.instance,
  };
}

function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  return String(v);
}
