import { promises as fs } from "fs";
import { resolve } from "path";
import { readdirSync, existsSync } from "fs";

export const SAFE_AGENT_NAME = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
export const MAX_LINES = 2000;
export const DEFAULT_LINES = 200;

export interface LogEntry {
  level: number;
  time: number;
  msg: string;
  instance?: string;
  [key: string]: unknown;
}

// ── Cursor helpers ────────────────────────────────────────────────────────────

export function encodeCursor(date: string, offsets: number[]): string {
  return Buffer.from(`${date}:${offsets.join(",")}`).toString("base64url");
}

export function decodeCursor(cursor: string): { date: string; offsets: number[] } | null {
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

export function logsDir(projectPath: string): string {
  return resolve(projectPath, ".al", "logs");
}

export function findLogFiles(projectPath: string, prefix: string): string[] {
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

export function findLatestLogFile(projectPath: string, prefix: string): string | null {
  const files = findLogFiles(projectPath, prefix);
  return files.length > 0 ? files[files.length - 1] : null;
}

export function dateFromLogFile(filePath: string): string | null {
  const match = filePath.match(/(\d{4}-\d{2}-\d{2})\.log$/);
  return match ? match[1] : null;
}

// ── File reading ──────────────────────────────────────────────────────────────

export function parseLine(line: string): LogEntry | null {
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
export async function readEntriesForward(
  filePath: string,
  byteOffset: number,
  limit: number,
  afterTime?: number,
  beforeTime?: number,
  instanceFilter?: string,
  grep?: RegExp,
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
        if (grep && !grep.test(JSON.stringify(entry))) continue;
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
export async function readLastEntries(
  filePath: string,
  limit: number,
  afterTime?: number,
  beforeTime?: number,
  instanceFilter?: string,
  grep?: RegExp,
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
          if (grep && !grep.test(JSON.stringify(entry))) continue;
          entries.unshift(entry);
          if (entries.length > limit) entries.shift();
        }
      }

      if (position === 0 && remainder.trim()) {
        const entry = parseLine(remainder);
        if (entry) {
          const inRange = (!afterTime || entry.time > afterTime) && (!beforeTime || entry.time < beforeTime)
            && (!instanceFilter || entry.instance === instanceFilter)
            && (!grep || grep.test(JSON.stringify(entry)));
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

/** Construct the path for a specific date's log file. Returns null if file doesn't exist. */
export function logFileForDate(projectPath: string, prefix: string, date: string): string | null {
  const filePath = resolve(logsDir(projectPath), `${prefix}-${date}.log`);
  return existsSync(filePath) ? filePath : null;
}

/** Read last N entries across multiple daily log files (newest first). */
export async function readLastEntriesMultiFile(
  files: string[],
  limit: number,
  afterTime?: number,
  beforeTime?: number,
  instanceFilter?: string,
  grep?: RegExp,
): Promise<{ entries: LogEntry[]; latestFile: string | null; byteOffset: number }> {
  if (files.length === 0) return { entries: [], latestFile: null, byteOffset: 0 };

  const collected: LogEntry[] = [];
  let latestByteOffset = 0;
  const latestFile = files[files.length - 1];

  // Iterate from newest to oldest
  for (let i = files.length - 1; i >= 0 && collected.length < limit; i--) {
    const remaining = limit - collected.length;
    const { entries, byteOffset } = await readLastEntries(
      files[i], remaining, afterTime, beforeTime, instanceFilter, grep,
    );
    if (i === files.length - 1) latestByteOffset = byteOffset;
    collected.unshift(...entries);
  }

  // Trim to limit (in case older files provided more than needed)
  const trimmed = collected.slice(-limit);
  return { entries: trimmed, latestFile, byteOffset: latestByteOffset };
}

/** Read entries forward across date boundaries starting from a cursor. */
export async function readEntriesForwardMultiFile(
  projectPath: string,
  prefix: string,
  cursorDate: string,
  cursorOffset: number,
  limit: number,
  afterTime?: number,
  beforeTime?: number,
  instanceFilter?: string,
  grep?: RegExp,
): Promise<{ entries: LogEntry[]; newDate: string; newOffset: number }> {
  const allFiles = findLogFiles(projectPath, prefix);
  if (allFiles.length === 0) return { entries: [], newDate: cursorDate, newOffset: cursorOffset };

  // Find the index of the cursor's date file (or the first file after it)
  let startIdx = allFiles.findIndex((f) => {
    const d = dateFromLogFile(f);
    return d !== null && d >= cursorDate;
  });
  if (startIdx === -1) startIdx = allFiles.length; // all files are older than cursor

  const collected: LogEntry[] = [];
  let finalDate = cursorDate;
  let finalOffset = cursorOffset;

  for (let i = startIdx; i < allFiles.length && collected.length < limit; i++) {
    const fileDate = dateFromLogFile(allFiles[i]);
    const isCursorFile = fileDate === cursorDate;
    const offset = isCursorFile ? cursorOffset : 0;
    const remaining = limit - collected.length;

    const { entries, newOffset } = await readEntriesForward(
      allFiles[i], offset, remaining, afterTime, beforeTime, instanceFilter, grep,
    );
    collected.push(...entries);
    finalDate = fileDate || cursorDate;
    finalOffset = newOffset;
  }

  return { entries: collected.slice(0, limit), newDate: finalDate, newOffset: finalOffset };
}

// ── Query parsing ─────────────────────────────────────────────────────────────

export function parseQueryParams(query: Record<string, string | undefined>) {
  let lines = parseInt(query.lines || query.limit || "", 10);
  if (isNaN(lines) || lines < 1) lines = DEFAULT_LINES;
  if (lines > MAX_LINES) lines = MAX_LINES;

  const cursor = query.cursor || undefined;
  const after = query.after ? parseInt(query.after, 10) : undefined;
  const before = query.before ? parseInt(query.before, 10) : undefined;
  const grep = query.grep || undefined;

  // Minimum log level: trace=10, debug=20, info=30, warn=40, error=50 (default: info)
  const levelNames: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };
  const rawLevel = query.level?.toLowerCase();
  const minLevel = rawLevel ? (levelNames[rawLevel] ?? parseInt(rawLevel, 10)) : 30;

  return { lines, cursor, after: isNaN(after as number) ? undefined : after, before: isNaN(before as number) ? undefined : before, grep, minLevel: isNaN(minLevel) ? 30 : minLevel };
}
