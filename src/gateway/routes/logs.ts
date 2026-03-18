import type { Hono } from "hono";
import { promises as fs } from "fs";
import { resolve } from "path";
import { readdirSync } from "fs";

const SAFE_AGENT_NAME = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
const MAX_LINES = 1000;
const DEFAULT_LINES = 50;

interface LogEntry {
  level: number;
  time: number;
  msg: string;
  instance?: string;
  [key: string]: unknown;
}

// ── Cursor helpers ────────────────────────────────────────────────────────────

function encodeCursor(date: string, offsets: number[]): string {
  return Buffer.from(`${date}:${offsets.join(",")}`).toString("base64url");
}

function decodeCursor(cursor: string): { date: string; offsets: number[] } | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
    const [date, offsetStr] = decoded.split(":");
    if (!date || !offsetStr) return null;
    const offsets = offsetStr.split(",").map(Number);
    if (offsets.some(isNaN)) return null;
    return { date, offsets };
  } catch {
    return null;
  }
}

// ── File discovery ────────────────────────────────────────────────────────────

function logsDir(projectPath: string): string {
  return resolve(projectPath, ".al", "logs");
}

function findLogFiles(projectPath: string, prefix: string): string[] {
  const dir = logsDir(projectPath);
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith(`${prefix}-`) && f.endsWith(".log"))
      .sort()
      .map((f) => resolve(dir, f));
  } catch {
    return [];
  }
}

function findLatestLogFile(projectPath: string, prefix: string): string | null {
  const files = findLogFiles(projectPath, prefix);
  return files.length > 0 ? files[files.length - 1] : null;
}

function dateFromLogFile(filePath: string): string | null {
  const match = filePath.match(/(\d{4}-\d{2}-\d{2})\.log$/);
  return match ? match[1] : null;
}

// ── File reading ──────────────────────────────────────────────────────────────

function parseLine(line: string): LogEntry | null {
  if (!line.trim()) return null;
  try {
    const obj = JSON.parse(line);
    // Container format normalization
    if (obj._log && typeof obj.level === "string") {
      const levelMap: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };
      const { _log, level: levelStr, ts, ...rest } = obj;
      return { ...rest, level: levelMap[levelStr] ?? 30, time: ts ?? Date.now() } as LogEntry;
    }
    return obj as LogEntry;
  } catch {
    return null;
  }
}

/** Read entries forward from a byte offset. Returns entries and new byte offset. */
async function readEntriesForward(
  filePath: string,
  byteOffset: number,
  limit: number,
  afterTime?: number,
  beforeTime?: number,
  instanceFilter?: string,
): Promise<{ entries: LogEntry[]; newOffset: number }> {
  try {
    const stat = await fs.stat(filePath);
    if (byteOffset >= stat.size) return { entries: [], newOffset: byteOffset };

    const fd = await fs.open(filePath, "r");
    try {
      const buf = Buffer.alloc(stat.size - byteOffset);
      await fd.read(buf, 0, buf.length, byteOffset);
      const text = buf.toString("utf-8");
      const lines = text.split("\n");
      const entries: LogEntry[] = [];

      for (const line of lines) {
        if (entries.length >= limit) break;
        const entry = parseLine(line);
        if (!entry) continue;
        if (afterTime && entry.time <= afterTime) continue;
        if (beforeTime && entry.time >= beforeTime) continue;
        if (instanceFilter && entry.instance !== instanceFilter) continue;
        entries.push(entry);
      }

      return { entries, newOffset: stat.size };
    } finally {
      await fd.close();
    }
  } catch {
    return { entries: [], newOffset: byteOffset };
  }
}

/** Read the last N entries from a file using reverse reading. */
async function readLastEntries(
  filePath: string,
  limit: number,
  afterTime?: number,
  beforeTime?: number,
  instanceFilter?: string,
): Promise<{ entries: LogEntry[]; byteOffset: number }> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size === 0) return { entries: [], byteOffset: 0 };

    const fd = await fs.open(filePath, "r");
    const entries: LogEntry[] = [];
    let position = stat.size;
    const chunkSize = 8192;
    const buffer = Buffer.alloc(chunkSize);
    let remainder = "";
    // We need more raw lines than limit because of filtering
    const rawLimit = limit * 3;
    let rawCount = 0;

    try {
      while (rawCount < rawLimit && position > 0) {
        const toRead = Math.min(chunkSize, position);
        position -= toRead;
        const { buffer: readBuf } = await fd.read(buffer, 0, toRead, position);
        const chunk = readBuf.toString("utf-8", 0, toRead);
        const text = chunk + remainder;
        const parts = text.split("\n");
        remainder = parts[0];

        for (let i = parts.length - 1; i >= 1; i--) {
          const line = parts[i];
          if (!line.trim()) continue;
          rawCount++;
          const entry = parseLine(line);
          if (!entry) continue;
          if (afterTime && entry.time <= afterTime) continue;
          if (beforeTime && entry.time >= beforeTime) continue;
          if (instanceFilter && entry.instance !== instanceFilter) continue;
          entries.unshift(entry);
          if (entries.length > limit) entries.shift();
        }
      }

      if (position === 0 && remainder.trim()) {
        const entry = parseLine(remainder);
        if (entry) {
          const inRange = (!afterTime || entry.time > afterTime) && (!beforeTime || entry.time < beforeTime)
            && (!instanceFilter || entry.instance === instanceFilter);
          if (inRange) {
            entries.unshift(entry);
            if (entries.length > limit) entries.shift();
          }
        }
      }
    } finally {
      await fd.close();
    }

    return { entries: entries.slice(-limit), byteOffset: stat.size };
  } catch {
    return { entries: [], byteOffset: 0 };
  }
}

// ── Route handlers ────────────────────────────────────────────────────────────

function parseQueryParams(query: Record<string, string | undefined>) {
  let lines = parseInt(query.lines || "", 10);
  if (isNaN(lines) || lines < 1) lines = DEFAULT_LINES;
  if (lines > MAX_LINES) lines = MAX_LINES;

  const cursor = query.cursor || undefined;
  const after = query.after ? parseInt(query.after, 10) : undefined;
  const before = query.before ? parseInt(query.before, 10) : undefined;

  return { lines, cursor, after: isNaN(after as number) ? undefined : after, before: isNaN(before as number) ? undefined : before };
}

export function registerLogRoutes(app: Hono, projectPath: string): void {
  // ── Scheduler logs ────────────────────────────────────────────────────────
  app.get("/api/logs/scheduler", async (c) => {
    const { lines, cursor, after, before } = parseQueryParams(c.req.query());

    if (cursor) {
      const parsed = decodeCursor(cursor);
      if (!parsed) return c.json({ error: "Invalid cursor" }, 400);

      const file = findLatestLogFile(projectPath, "scheduler");
      if (!file) return c.json({ entries: [], cursor: null, hasMore: false });

      const currentDate = dateFromLogFile(file);
      // If date rolled over, read from start of new file
      const offset = currentDate !== parsed.date ? 0 : parsed.offsets[0] || 0;
      const { entries, newOffset } = await readEntriesForward(file, offset, lines, after, before);
      const newCursor = encodeCursor(currentDate || parsed.date, [newOffset]);
      return c.json({ entries, cursor: newCursor, hasMore: entries.length >= lines });
    }

    const file = findLatestLogFile(projectPath, "scheduler");
    if (!file) return c.json({ entries: [], cursor: null, hasMore: false });

    const { entries, byteOffset } = await readLastEntries(file, lines, after, before);
    const date = dateFromLogFile(file) || "";
    const resCursor = encodeCursor(date, [byteOffset]);
    return c.json({ entries, cursor: resCursor, hasMore: false });
  });

  // ── Agent logs (all instances in one file) ─────────────────────────────
  app.get("/api/logs/agents/:name", async (c) => {
    const name = c.req.param("name");
    if (!SAFE_AGENT_NAME.test(name)) return c.json({ error: "Invalid agent name" }, 400);

    const { lines, cursor, after, before } = parseQueryParams(c.req.query());

    const file = findLatestLogFile(projectPath, name);
    if (!file) return c.json({ entries: [], cursor: null, hasMore: false });

    if (cursor) {
      const parsed = decodeCursor(cursor);
      if (!parsed) return c.json({ error: "Invalid cursor" }, 400);
      const currentDate = dateFromLogFile(file);
      const offset = currentDate !== parsed.date ? 0 : parsed.offsets[0] || 0;
      const { entries, newOffset } = await readEntriesForward(file, offset, lines, after, before);
      const newCursor = encodeCursor(currentDate || parsed.date, [newOffset]);
      return c.json({ entries, cursor: newCursor, hasMore: entries.length >= lines });
    }

    const { entries, byteOffset } = await readLastEntries(file, lines, after, before);
    const date = dateFromLogFile(file) || "";
    return c.json({ entries, cursor: encodeCursor(date, [byteOffset]), hasMore: false });
  });

  // ── Specific instance logs (filter by instance field) ─────────────────
  app.get("/api/logs/agents/:name/:instanceId", async (c) => {
    const name = c.req.param("name");
    const instanceId = c.req.param("instanceId");
    if (!SAFE_AGENT_NAME.test(name)) return c.json({ error: "Invalid agent name" }, 400);

    // instanceId should be a lowercase alphanumeric run suffix (e.g. "a1b2c3d4")
    if (!/^[a-z0-9]+$/.test(instanceId)) return c.json({ error: "Invalid instance ID" }, 400);

    const { lines, cursor, after, before } = parseQueryParams(c.req.query());
    const instanceFilter = `${name}-${instanceId}`;

    const file = findLatestLogFile(projectPath, name);
    if (!file) return c.json({ entries: [], cursor: null, hasMore: false });

    if (cursor) {
      const parsed = decodeCursor(cursor);
      if (!parsed) return c.json({ error: "Invalid cursor" }, 400);
      const currentDate = dateFromLogFile(file);
      const offset = currentDate !== parsed.date ? 0 : parsed.offsets[0] || 0;
      const { entries, newOffset } = await readEntriesForward(file, offset, lines, after, before, instanceFilter);
      const newCursor = encodeCursor(currentDate || parsed.date, [newOffset]);
      return c.json({ entries, cursor: newCursor, hasMore: entries.length >= lines });
    }

    const { entries, byteOffset } = await readLastEntries(file, lines, after, before, instanceFilter);
    const date = dateFromLogFile(file) || "";
    return c.json({ entries, cursor: encodeCursor(date, [byteOffset]), hasMore: false });
  });
}
