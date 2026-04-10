import { resolve } from "path";
import { createReadStream, readdirSync, existsSync, statSync } from "fs";
import { createInterface } from "readline";
import { logsDir } from "../../shared/paths.js";
import { formatLogEntry as formatShared } from "../../shared/log-format.js";
import type { LogEntry as SharedLogEntry, FormattedLogLine, LogPrefix } from "../../shared/log-format.js";

/**
 * Detect if a string looks like an instance ID (agent-name + 8-char hex suffix).
 * Returns { agent, instanceSuffix } if it matches, or null if it's a plain agent name.
 */
function parseInstanceId(value: string): { agent: string; instanceSuffix: string } | null {
  const match = value.match(/^(.+)-([0-9a-f]{8})$/);
  if (!match) return null;
  return { agent: match[1], instanceSuffix: match[2] };
}

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";
const GRAY = "\x1b[90m";

// ── Prefix → ANSI color mapping ──────────────────────────────────────────────

const PREFIX_COLORS: Record<LogPrefix, { icon: string; color: string }> = {
  tool:     { icon: "▸", color: CYAN },
  result:   { icon: "↳", color: GRAY },
  error:    { icon: "✗", color: RED },
  thinking: { icon: "💭", color: BLUE },
  text:     { icon: "▶", color: WHITE },
  run:      { icon: "●", color: MAGENTA },
  warn:     { icon: "⚠", color: YELLOW },
  debug:    { icon: "·", color: GRAY },
};

// ── Raw format (--raw) ───────────────────────────────────────────────────────

const LEVEL_COLORS: Record<number, { label: string; color: string }> = {
  10: { label: "TRACE", color: GRAY },
  20: { label: "DEBUG", color: CYAN },
  30: { label: "INFO",  color: GREEN },
  40: { label: "WARN",  color: YELLOW },
  50: { label: "ERROR", color: RED },
};

interface LogEntry extends SharedLogEntry {
  name?: string;
  pid?: number;
  hostname?: string;
}

type Formatter = (entry: LogEntry) => string | null;

function formatRawEntry(entry: LogEntry): string {
  const date = new Date(entry.time);
  const time = date.toLocaleTimeString("en-US", { hour12: false });
  const levelInfo = LEVEL_COLORS[entry.level] || { label: `L${entry.level}`, color: "" };

  const { level, time: _t, msg, name: _n, instance: _i, pid: _p, hostname: _h, ...extra } = entry;
  const instanceTag = entry.instance ? `${MAGENTA}[${entry.instance}]${RESET} ` : "";
  const extraStr = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : "";

  return `${levelInfo.color}${time} ${levelInfo.label.padEnd(5)}${RESET} ${instanceTag}${levelInfo.color}${msg}${extraStr}${RESET}`;
}

// ── Conversation format (default) ────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false });
}

function formatConversationEntry(entry: LogEntry, showAll = false): string | null {
  const formatted = formatShared(entry, showAll);
  if (!formatted) return null;
  return renderFormattedLine(formatted);
}

function renderFormattedLine(f: FormattedLogLine): string {
  const time = `${DIM}${formatTime(f.timestamp)}${RESET}`;
  const instanceTag = f.instance ? `${MAGENTA}[${f.instance}]${RESET} ` : "";
  const { icon, color } = PREFIX_COLORS[f.prefix];
  const levelColor = f.level === "error" ? RED : f.level === "warn" ? YELLOW : "";

  // Run lifecycle gets special bold treatment
  if (f.prefix === "run") {
    const resultColor = f.body.startsWith("completed") ? GREEN
      : f.body.startsWith("error") ? RED
      : f.body.startsWith("Starting") ? `${MAGENTA}${BOLD}`
      : "";
    return `${time}  ${instanceTag}${resultColor}${icon} ${f.body}${RESET}`;
  }

  // Tool call: icon + label: body
  if (f.label) {
    const label = `${BOLD}${f.label}${RESET}`;
    const bodyColor = levelColor || color;
    // Multi-line body: indent continuation lines
    const lines = f.body.split("\n");
    const first = `${time}  ${instanceTag}${bodyColor}${icon} ${label}: ${lines[0]}${RESET}`;
    if (lines.length === 1) return first;
    const rest = lines.slice(1).map((l) => `          ${bodyColor}${l}${RESET}`).join("\n");
    return `${first}\n${rest}`;
  }

  // Text/thinking: icon + body (multi-line indented)
  const bodyColor = levelColor || color;
  const lines = f.body.split("\n");
  const first = `${time}  ${instanceTag}${bodyColor}${icon} ${lines[0]}${RESET}`;
  if (lines.length === 1) return first;
  const rest = lines.slice(1).map((l) => `          ${bodyColor}${l}${RESET}`).join("\n");
  return `${first}\n${rest}`;
}

// ── Run header ───────────────────────────────────────────────────────────────

function formatRunHeader(entry: LogEntry): string | null {
  const { msg } = entry;
  if (msg.startsWith("Starting ") && msg.includes("transport run")) {
    const agentName = entry.name || "agent";
    const instance = entry.instance ? `  ${entry.instance}` : "";
    const label = ` ${agentName}${instance} `;
    const line = "─".repeat(Math.max(0, 60 - label.length));
    return `\n${DIM}──${RESET}${MAGENTA}${BOLD}${label}${RESET}${DIM}${line}${RESET}`;
  }
  return null;
}

// ── Time value parsing ────────────────────────────────────────────────────────

/**
 * Parse a time value string into a Unix timestamp (ms).
 * Accepts relative durations like "2h" or "7d", and ISO date strings.
 */
function parseTimeValue(value: string): number {
  // Try relative duration: Nh or Nd
  const relMatch = value.match(/^(\d+)(h|d)$/);
  if (relMatch) {
    const n = parseInt(relMatch[1], 10);
    const unit = relMatch[2];
    const ms = unit === "h" ? n * 3_600_000 : n * 86_400_000;
    return Date.now() - ms;
  }
  // Try ISO date / any date string
  const parsed = Date.parse(value);
  if (!isNaN(parsed)) return parsed;
  throw new Error(`Invalid time value: "${value}". Use a relative duration (e.g. 2h, 7d) or an ISO date string.`);
}

// ── Shared parsing & file helpers ─────────────────────────────────────────────

// ── Log level mapping ────────────────────────────────────────────────────────

const LEVEL_NAME_TO_NUM: Record<string, number> = {
  trace: 10, debug: 20, info: 30, warn: 40, error: 50,
};

// Lambda/ECS platform lines that should be filtered in conversation mode
const PLATFORM_LINE_RE = /^(START |END |REPORT |INIT_START |EXTENSION )/;

/**
 * Parse a log line into a normalized LogEntry.
 * Handles both pino format ({level: 30, time, msg}) and container format
 * ({_log: true, level: "info", msg, ts}).
 */
function parseLine(line: string): LogEntry | null {
  if (!line.trim()) return null;
  // Skip Lambda/CloudWatch platform lines
  if (PLATFORM_LINE_RE.test(line)) return null;
  try {
    const obj = JSON.parse(line);
    // Container format: { _log: true, level: "info", msg: "...", ts: 1234 }
    if (obj._log && typeof obj.level === "string") {
      const { _log, level: levelStr, ts, ...rest } = obj;
      return {
        ...rest,
        level: LEVEL_NAME_TO_NUM[levelStr] ?? 30,
        time: ts ?? Date.now(),
      } as LogEntry;
    }
    return obj as LogEntry;
  } catch {
    return null;
  }
}

function findLogFile(dir: string, agent: string, date?: string): string | null {
  if (date) {
    const file = resolve(dir, `${agent}-${date}.log`);
    return existsSync(file) ? file : null;
  }

  // Try today's file first (common case optimization)
  const today = new Date().toISOString().slice(0, 10);
  const todayFile = resolve(dir, `${agent}-${today}.log`);
  if (existsSync(todayFile)) return todayFile;

  // Try yesterday's file (also common)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const yesterdayFile = resolve(dir, `${agent}-${yesterday}.log`);
  if (existsSync(yesterdayFile)) return yesterdayFile;

  // Fallback to directory scan only if neither today nor yesterday exists
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(`${agent}-`) && f.endsWith(".log"))
    .sort()
    .reverse();

  return files.length > 0 ? resolve(dir, files[0]) : null;
}

// ── Reading & following ───────────────────────────────────────────────────────

/**
 * Efficiently read the last N lines from a file by reading backwards from the end.
 * This avoids reading the entire file when we only need the last few lines.
 */
async function readLastNLines(filePath: string, n: number): Promise<string[]> {
  const fs = await import("fs");
  const stat = await fs.promises.stat(filePath);
  const fileSize = stat.size;

  if (fileSize === 0) return [];

  const fd = await fs.promises.open(filePath, 'r');
  const lines: string[] = [];
  let position = fileSize;
  let buffer = Buffer.alloc(8192); // 8KB chunks
  let remainder = '';

  try {
    while (lines.length < n && position > 0) {
      const chunkSize = Math.min(buffer.length, position);
      position -= chunkSize;

      const { buffer: readBuffer } = await fd.read(buffer, 0, chunkSize, position);
      const chunk = readBuffer.toString('utf-8', 0, chunkSize);

      const text = chunk + remainder;
      const parts = text.split('\n');

      remainder = parts[0];

      for (let i = parts.length - 1; i >= 1; i--) {
        const line = parts[i];
        if (line.trim()) {
          lines.unshift(line);
          if (lines.length >= n) break;
        }
      }
    }

    if (position === 0 && remainder.trim()) {
      lines.unshift(remainder);
      if (lines.length > n) {
        lines.splice(0, lines.length - n);
      }
    }
  } finally {
    await fd.close();
  }

  return lines.slice(-n);
}

async function readLastN(filePath: string, n: number, fmt: Formatter, showRunHeaders = false): Promise<void> {
  const lines = await readLastNLines(filePath, n * 3); // Read more raw lines to account for filtering
  const entries: string[] = [];

  for (const line of lines) {
    const entry = parseLine(line);
    if (entry) {
      const header = showRunHeaders ? formatRunHeader(entry) : null;
      const formatted = fmt(entry);
      if (header) {
        entries.push(header);
        if (entries.length > n) entries.shift();
      }
      if (formatted) {
        entries.push(formatted);
        if (entries.length > n) entries.shift();
      }
    }
  }

  for (const formatted of entries) {
    console.log(formatted);
  }
}

async function readNewData(filePath: string, start: number, fmt: Formatter, showRunHeaders = false): Promise<{ newPosition: number }> {
  const currentSize = statSync(filePath).size;
  if (currentSize <= start) return { newPosition: start };

  const stream = createReadStream(filePath, { encoding: "utf-8", start });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const entry = parseLine(line);
    if (entry) {
      if (showRunHeaders) {
        const header = formatRunHeader(entry);
        if (header) console.log(header);
      }
      const formatted = fmt(entry);
      if (formatted) console.log(formatted);
    }
  }

  return { newPosition: currentSize };
}

async function followFile(filePath: string, lastN: number, fmt: Formatter, showRunHeaders = false): Promise<void> {
  await readLastN(filePath, lastN, fmt, showRunHeaders);

  let position = statSync(filePath).size;

  let watcher: import("fs").FSWatcher | null = null;
  let pollInterval: NodeJS.Timeout | null = null;

  const cleanup = () => {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  };

  const readNewChanges = async () => {
    try {
      const { newPosition } = await readNewData(filePath, position, fmt, showRunHeaders);
      position = newPosition;
    } catch {
      // File may have been rotated or removed — ignore
    }
  };

  try {
    const fs = await import("fs");
    watcher = fs.watch(filePath, { persistent: false }, async (eventType) => {
      if (eventType === 'change') {
        await readNewChanges();
      }
    });

    pollInterval = setInterval(readNewChanges, 2000);

  } catch {
    pollInterval = setInterval(readNewChanges, 500);
  }

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  await new Promise(() => {});
}

// ── Main execute ──────────────────────────────────────────────────────────────

export async function execute(
  agent: string,
  opts: { project: string; lines: string; follow?: boolean; date?: string; raw?: boolean; all?: boolean; env?: string; grep?: string; after?: string; before?: string }
): Promise<void> {
  const projectPath = resolve(opts.project);
  const fmt: Formatter = opts.raw
    ? formatRawEntry
    : opts.all
      ? (entry) => formatConversationEntry(entry, true)
      : formatConversationEntry;

  // Auto-detect if the positional agent arg is a full instance ID (e.g. "dev-a1b2c3d4")
  let resolvedAgent = agent;
  let instanceSuffix: string | undefined;
  const parsed = parseInstanceId(agent);
  if (parsed) {
    resolvedAgent = parsed.agent;
    instanceSuffix = parsed.instanceSuffix;
  }

  const n = parseInt(opts.lines, 10);

  // Parse --after / --before / --grep
  let afterTs: number | undefined;
  let beforeTs: number | undefined;
  let grepRe: RegExp | undefined;

  if (opts.after) {
    try { afterTs = parseTimeValue(opts.after); }
    catch (e: any) { console.error(`Error: ${e.message}`); process.exit(1); }
  }
  if (opts.before) {
    try { beforeTs = parseTimeValue(opts.before); }
    catch (e: any) { console.error(`Error: ${e.message}`); process.exit(1); }
  }
  if (opts.grep) {
    try { grepRe = new RegExp(opts.grep); }
    catch { console.error(`Error: Invalid grep pattern: "${opts.grep}"`); process.exit(1); }
  }

  // Build API path
  let apiPath: string;
  if (resolvedAgent === "scheduler") {
    apiPath = "/api/logs/scheduler";
  } else if (instanceSuffix !== undefined) {
    apiPath = `/api/logs/agents/${encodeURIComponent(resolvedAgent)}/${encodeURIComponent(agent)}`;
  } else {
    apiPath = `/api/logs/agents/${encodeURIComponent(resolvedAgent)}`;
  }

  try {
    const { gatewayFetch } = await import("../gateway-client.js");

    const formatAndPrintEntries = (entries: LogEntry[]) => {
      for (const entry of entries) {
        if (fmt === formatConversationEntry) {
          const header = formatRunHeader(entry);
          if (header) console.log(header);
        }
        const formatted = fmt(entry);
        if (formatted) console.log(formatted);
      }
    };

    // Helper to apply grep filter on entries received from gateway
    const applyGrepFilter = (entries: LogEntry[]): LogEntry[] => {
      if (!grepRe) return entries;
      return entries.filter((e) => grepRe!.test(JSON.stringify(e)));
    };

    // Build base query params (time range + grep forwarded for server-side pre-filtering)
    const buildBaseParams = () => {
      const p = new URLSearchParams({ lines: String(n) });
      if (afterTs !== undefined) p.set("after", String(afterTs));
      if (beforeTs !== undefined) p.set("before", String(beforeTs));
      if (opts.grep) p.set("grep", opts.grep);
      return p;
    };

    if (opts.follow) {
      // Initial fetch
      const params = buildBaseParams();
      const res = await gatewayFetch({ project: opts.project, path: `${apiPath}?${params}`, env: opts.env });
      if (!res.ok) throw new Error(`Gateway returned ${res.status}`);
      const data = await res.json() as { entries: LogEntry[]; cursor: string | null; hasMore: boolean };
      formatAndPrintEntries(applyGrepFilter(data.entries));
      let cursor = data.cursor;

      // Poll with cursor
      const poll = async () => {
        const p = new URLSearchParams();
        if (cursor) p.set("cursor", cursor);
        if (opts.grep) p.set("grep", opts.grep);
        try {
          const r = await gatewayFetch({ project: opts.project, path: `${apiPath}?${p}`, env: opts.env });
          if (r.ok) {
            const d = await r.json() as { entries: LogEntry[]; cursor: string | null; hasMore: boolean };
            formatAndPrintEntries(applyGrepFilter(d.entries));
            if (d.cursor) cursor = d.cursor;
          }
        } catch {
          // Connection lost — silently retry next interval
        }
      };

      const interval = setInterval(poll, 1000);
      process.on("SIGINT", () => {
        clearInterval(interval);
        process.exit(0);
      });
      await new Promise(() => {});
    } else {
      const params = buildBaseParams();
      const res = await gatewayFetch({ project: opts.project, path: `${apiPath}?${params}`, env: opts.env });
      if (!res.ok) throw new Error(`Gateway returned ${res.status}`);
      const data = await res.json() as { entries: LogEntry[]; cursor: string | null; hasMore: boolean };
      const filtered = applyGrepFilter(data.entries);
      if (filtered.length === 0) {
        console.log(`No log entries found for "${resolvedAgent}".`);
      } else {
        formatAndPrintEntries(filtered);
      }
    }
  } catch {
    // Gateway not running — fall back to direct file reading
    const dir = logsDir(projectPath);
    const logFile = findLogFile(dir, resolvedAgent, opts.date);

    if (!logFile) {
      const dateStr = opts.date || "today";
      console.error(`No log file found for agent "${resolvedAgent}" (${dateStr}) in ${dir}`);
      process.exit(1);
    }

    // When instance / --after / --before / --grep are specified, wrap the formatter
    const instanceFilter = instanceSuffix !== undefined ? `${resolvedAgent}-${instanceSuffix}` : undefined;
    const filteredFmt: Formatter = (entry) => {
      if (instanceFilter && entry.instance !== instanceFilter) return null;
      if (afterTs !== undefined && entry.time <= afterTs) return null;
      if (beforeTs !== undefined && entry.time >= beforeTs) return null;
      if (grepRe && !grepRe.test(JSON.stringify(entry))) return null;
      return fmt(entry);
    };

    // Show run headers only in default conversation mode (not raw, not --all)
    const showRunHeaders = fmt === formatConversationEntry;

    if (opts.follow) {
      await followFile(logFile, n, filteredFmt, showRunHeaders);
    } else {
      await readLastN(logFile, n, filteredFmt, showRunHeaders);
    }
  }
}
