import { resolve } from "path";
import { createReadStream, readdirSync, existsSync, statSync } from "fs";
import { createInterface } from "readline";
import { logsDir } from "../../shared/paths.js";

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

// ── Raw format (--raw) ───────────────────────────────────────────────────────

const LEVEL_COLORS: Record<number, { label: string; color: string }> = {
  10: { label: "TRACE", color: GRAY },
  20: { label: "DEBUG", color: CYAN },
  30: { label: "INFO",  color: GREEN },
  40: { label: "WARN",  color: YELLOW },
  50: { label: "ERROR", color: RED },
};

interface LogEntry {
  level: number;
  time: number;
  msg: string;
  name?: string;
  pid?: number;
  hostname?: string;
  [key: string]: unknown;
}

type Formatter = (entry: LogEntry) => string | null;

function formatRawEntry(entry: LogEntry): string {
  const date = new Date(entry.time);
  const time = date.toLocaleTimeString("en-US", { hour12: false });
  const levelInfo = LEVEL_COLORS[entry.level] || { label: `L${entry.level}`, color: "" };

  const { level, time: _t, msg, name: _n, pid: _p, hostname: _h, ...extra } = entry;
  const extraStr = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : "";

  return `${levelInfo.color}${time} ${levelInfo.label.padEnd(5)} ${msg}${extraStr}${RESET}`;
}

// ── Conversation format (default) ────────────────────────────────────────────

// Messages we skip entirely in conversation mode
const SKIP_MESSAGES = new Set([
  "event",
  "tool done",
]);

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false });
}

function formatConversationEntry(entry: LogEntry): string | null {
  const time = `${DIM}${formatTime(entry.time)}${RESET}`;
  const { msg } = entry;

  // Skip debug-level noise (except tool errors which are level 50)
  if (entry.level <= 20 && !SKIP_MESSAGES.has(msg)) {
    // Show debug tool starts for non-bash tools
    if (msg === "tool start") {
      const tool = String(entry.tool || "unknown");
      return `${time}  ${BLUE}▸ ${tool}${RESET}`;
    }
    // Skip all other debug entries
    return null;
  }

  if (SKIP_MESSAGES.has(msg)) return null;

  // ── Assistant text output ──
  if (msg === "assistant") {
    const text = String(entry.text || "");
    if (!text) return null;
    // Indent multi-line text under the timestamp
    const lines = text.split("\n");
    const first = `${time}  ${WHITE}${BOLD}${lines[0]}${RESET}`;
    if (lines.length === 1) return first;
    const rest = lines.slice(1).map((l) => `          ${WHITE}${l}${RESET}`).join("\n");
    return `${first}\n${rest}`;
  }

  // ── Bash command ──
  if (msg === "bash") {
    const cmd = String(entry.cmd || "");
    return `${time}  ${CYAN}$ ${cmd}${RESET}`;
  }

  // ── Tool start (non-bash, logged at info level in some paths) ──
  if (msg === "tool start") {
    const tool = String(entry.tool || "unknown");
    return `${time}  ${BLUE}▸ ${tool}${RESET}`;
  }

  // ── Tool error ──
  if (msg === "tool error") {
    const tool = String(entry.tool || "unknown");
    const cmd = entry.cmd ? `\n          ${DIM}$ ${String(entry.cmd)}${RESET}` : "";
    const result = entry.result ? `\n          ${DIM}${String(entry.result).slice(0, 300)}${RESET}` : "";
    return `${time}  ${RED}✗ ${tool} failed${RESET}${cmd}${result}`;
  }

  // ── Run lifecycle ──
  if (msg.startsWith("Starting ")) {
    const container = entry.container ? `${DIM} (${entry.container})${RESET}` : "";
    return `${time}  ${MAGENTA}${BOLD}${msg}${RESET}${container}`;
  }

  if (msg === "run completed" || msg === "run completed, rerun requested") {
    const suffix = msg.includes("rerun") ? ` ${YELLOW}(rerun requested)${RESET}` : "";
    return `${time}  ${GREEN}${BOLD}Run completed${RESET}${suffix}`;
  }

  if (msg === "container launched") {
    const container = entry.container ? ` ${DIM}${entry.container}${RESET}` : "";
    return `${time}  ${DIM}Container launched${container}${RESET}`;
  }

  if (msg === "container finished" || msg === "container finished (rerun requested)") {
    const elapsed = entry.elapsed ? ` ${DIM}(${entry.elapsed})${RESET}` : "";
    return `${time}  ${DIM}Container finished${elapsed}${RESET}`;
  }

  // ── Container/session setup messages ──
  if (msg === "container starting") {
    const agentName = String(entry.agentName || "");
    const modelId = entry.modelId ? ` ${DIM}model=${entry.modelId}${RESET}` : "";
    return `${time}  ${MAGENTA}${BOLD}Container starting: ${agentName}${RESET}${modelId}`;
  }

  if (msg === "creating agent session" || msg === "session created, sending prompt") {
    return `${time}  ${DIM}${msg}${RESET}`;
  }

  // ── Errors and warnings ──
  if (entry.level >= 50) {
    const errDetail = entry.err ? ` ${DIM}${JSON.stringify(entry.err).slice(0, 300)}${RESET}` : "";
    return `${time}  ${RED}${BOLD}ERROR: ${msg}${RESET}${errDetail}`;
  }

  if (entry.level >= 40) {
    return `${time}  ${YELLOW}WARN: ${msg}${RESET}`;
  }

  // ── Catch-all for other info messages ──
  return `${time}  ${DIM}${msg}${RESET}`;
}

// ── Run header ───────────────────────────────────────────────────────────────

function formatRunHeader(entry: LogEntry): string | null {
  const { msg } = entry;
  // Detect run start to print a separator header
  if (msg.startsWith("Starting ") && (msg.includes(" run") || msg.includes(" container run"))) {
    const agentName = entry.name || "agent";
    const container = entry.container ? `  ${entry.container}` : "";
    const label = ` ${agentName}${container} `;
    const line = "─".repeat(Math.max(0, 60 - label.length));
    return `\n${DIM}──${RESET}${MAGENTA}${BOLD}${label}${RESET}${DIM}${line}${RESET}`;
  }
  return null;
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
      // Calculate how much to read (up to buffer size, but not before start of file)
      const chunkSize = Math.min(buffer.length, position);
      position -= chunkSize;
      
      // Read chunk from file
      const { buffer: readBuffer } = await fd.read(buffer, 0, chunkSize, position);
      const chunk = readBuffer.toString('utf-8', 0, chunkSize);
      
      // Combine with any remainder from previous iteration and split by newlines
      const text = chunk + remainder;
      const parts = text.split('\n');
      
      // The first part becomes the new remainder (since we're reading backwards)
      remainder = parts[0];
      
      // Add lines in reverse order (excluding the first part which is incomplete)
      for (let i = parts.length - 1; i >= 1; i--) {
        const line = parts[i];
        if (line.trim()) { // Skip empty lines
          lines.unshift(line);
          if (lines.length >= n) break;
        }
      }
    }
    
    // Handle any remaining text if we've read the whole file
    if (position === 0 && remainder.trim()) {
      lines.unshift(remainder);
      if (lines.length > n) {
        lines.splice(0, lines.length - n);
      }
    }
  } finally {
    await fd.close();
  }
  
  return lines.slice(-n); // Ensure we return exactly n lines (or fewer if file is smaller)
}

async function readLastN(filePath: string, n: number, fmt: Formatter): Promise<void> {
  const lines = await readLastNLines(filePath, n * 3); // Read more raw lines to account for filtering
  const entries: string[] = [];

  for (const line of lines) {
    const entry = parseLine(line);
    if (entry) {
      const header = fmt === formatConversationEntry ? formatRunHeader(entry) : null;
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

async function readNewData(filePath: string, start: number, fmt: Formatter): Promise<{ newPosition: number }> {
  const currentSize = statSync(filePath).size;
  if (currentSize <= start) return { newPosition: start };

  const stream = createReadStream(filePath, { encoding: "utf-8", start });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const entry = parseLine(line);
    if (entry) {
      if (fmt === formatConversationEntry) {
        const header = formatRunHeader(entry);
        if (header) console.log(header);
      }
      const formatted = fmt(entry);
      if (formatted) console.log(formatted);
    }
  }

  return { newPosition: currentSize };
}

async function followFile(filePath: string, lastN: number, fmt: Formatter): Promise<void> {
  await readLastN(filePath, lastN, fmt);

  let position = statSync(filePath).size;

  // Use fs.watch instead of polling for better performance
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
      const { newPosition } = await readNewData(filePath, position, fmt);
      position = newPosition;
    } catch {
      // File may have been rotated or removed — ignore
    }
  };

  try {
    // Try to use fs.watch() for efficient file monitoring
    const fs = await import("fs");
    watcher = fs.watch(filePath, { persistent: false }, async (eventType) => {
      if (eventType === 'change') {
        await readNewChanges();
      }
    });

    // fs.watch can be unreliable on some systems, so add a fallback poll
    // but with a longer interval since watch should catch most changes
    pollInterval = setInterval(readNewChanges, 2000); // 2s instead of 500ms

  } catch {
    // fs.watch failed, fall back to polling only
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
  opts: { project: string; lines: string; follow?: boolean; date?: string; raw?: boolean; env?: string; instance?: string }
): Promise<void> {
  const projectPath = resolve(opts.project);
  const fmt: Formatter = opts.raw ? formatRawEntry : formatConversationEntry;
  const instanceNum = opts.instance ? parseInt(opts.instance, 10) : undefined;

  const n = parseInt(opts.lines, 10);

  // Build API path
  let apiPath: string;
  if (agent === "scheduler") {
    apiPath = "/api/logs/scheduler";
  } else if (instanceNum !== undefined) {
    apiPath = `/api/logs/agents/${encodeURIComponent(agent)}/${instanceNum}`;
  } else {
    apiPath = `/api/logs/agents/${encodeURIComponent(agent)}`;
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

    if (opts.follow) {
      // Initial fetch
      const params = new URLSearchParams({ lines: String(n) });
      const res = await gatewayFetch({ project: opts.project, path: `${apiPath}?${params}` });
      if (!res.ok) throw new Error(`Gateway returned ${res.status}`);
      const data = await res.json() as { entries: LogEntry[]; cursor: string | null; hasMore: boolean };
      formatAndPrintEntries(data.entries);
      let cursor = data.cursor;

      // Poll with cursor
      const poll = async () => {
        const p = new URLSearchParams();
        if (cursor) p.set("cursor", cursor);
        try {
          const r = await gatewayFetch({ project: opts.project, path: `${apiPath}?${p}` });
          if (r.ok) {
            const d = await r.json() as { entries: LogEntry[]; cursor: string | null; hasMore: boolean };
            formatAndPrintEntries(d.entries);
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
      const params = new URLSearchParams({ lines: String(n) });
      const res = await gatewayFetch({ project: opts.project, path: `${apiPath}?${params}` });
      if (!res.ok) throw new Error(`Gateway returned ${res.status}`);
      const data = await res.json() as { entries: LogEntry[]; cursor: string | null; hasMore: boolean };
      if (data.entries.length === 0) {
        console.log(`No log entries found for "${agent}".`);
      } else {
        formatAndPrintEntries(data.entries);
      }
    }
  } catch {
    // Gateway not running — fall back to direct file reading
    const dir = logsDir(projectPath);
    const logName = instanceNum !== undefined ? `${agent}-${instanceNum}` : agent;
    const logFile = findLogFile(dir, logName, opts.date);

    if (!logFile) {
      const dateStr = opts.date || "today";
      if (instanceNum !== undefined) {
        console.error(`No log file found for agent "${agent}" instance ${instanceNum} (${dateStr}) in ${dir}`);
      } else {
        console.error(`No log file found for agent "${agent}" (${dateStr}) in ${dir}`);
      }
      process.exit(1);
    }

    if (opts.follow) {
      await followFile(logFile, n, fmt);
    } else {
      await readLastN(logFile, n, fmt);
    }
  }
}
