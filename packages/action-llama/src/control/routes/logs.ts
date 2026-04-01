import type { Hono } from "hono";
import {
  SAFE_AGENT_NAME,
  findLogFiles,
  dateFromLogFile,
  readLastEntriesMultiFile,
  readEntriesForwardMultiFile,
  readLastEntries,
  encodeCursor,
  decodeCursor,
  parseQueryParams,
  type LogEntry,
} from "./log-helpers.js";

async function handleLogRequest(
  projectPath: string,
  prefix: string,
  query: Record<string, string | undefined>,
  instanceFilter?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { lines, cursor, after, before, grep, minLevel } = parseQueryParams(query);
  const backCursorParam = query.back_cursor;
  let grepRe: RegExp | undefined;
  if (grep) {
    try { grepRe = new RegExp(grep); }
    catch { return { status: 400, body: { error: "Invalid grep pattern" } }; }
  }

  const filterLevel = (entries: LogEntry[]) =>
    minLevel > 0 ? entries.filter((e) => e.level >= minLevel) : entries;

  // Handle backward cursor pagination
  if (backCursorParam) {
    const parsed = decodeCursor(backCursorParam);
    if (!parsed) return { status: 400, body: { error: "Invalid back_cursor" } };

    const allFiles = findLogFiles(projectPath, prefix);
    if (allFiles.length === 0) return { status: 200, body: { entries: [], cursor: null, backCursor: null, hasMore: false } };

    // Find the file for the cursor's date
    const cursorFileIdx = allFiles.findIndex(f => dateFromLogFile(f) === parsed.date);
    
    // Read backward from cursor position, spanning multiple files if needed
    const collected: LogEntry[] = [];
    let newBackDate: string | null = null;
    let newBackOffset = 0;
    const startIdx = cursorFileIdx >= 0 ? cursorFileIdx : allFiles.length - 1;

    for (let i = startIdx; i >= 0 && collected.length < lines; i--) {
      const remaining = lines - collected.length;
      const startPos = (i === startIdx) ? parsed.offsets[0] : undefined;
      const { entries, scanStoppedAt } = await readLastEntries(
        allFiles[i], remaining, undefined, undefined, instanceFilter, grepRe, startPos,
      );
      collected.unshift(...entries);
      newBackDate = dateFromLogFile(allFiles[i]);
      newBackOffset = scanStoppedAt;
      if (i === 0 && scanStoppedAt === 0) {
        newBackDate = null;
        newBackOffset = 0;
      }
    }

    const filtered = filterLevel(collected.slice(-lines));
    const newBackCursor = newBackDate ? encodeCursor(newBackDate, [newBackOffset]) : null;
    return { status: 200, body: { entries: filtered, cursor: null, backCursor: newBackCursor, hasMore: false } };
  }

  if (cursor) {
    const parsed = decodeCursor(cursor);
    if (!parsed) return { status: 400, body: { error: "Invalid cursor" } };

    const files = findLogFiles(projectPath, prefix);
    if (files.length === 0) return { status: 200, body: { entries: [], cursor: null, backCursor: null, hasMore: false } };

    const { entries, newDate, newOffset } = await readEntriesForwardMultiFile(
      projectPath, prefix, parsed.date, parsed.offsets[0] || 0, lines,
      after, before, instanceFilter, grepRe,
    );
    const filtered = filterLevel(entries);
    const newCursor = encodeCursor(newDate, [newOffset]);
    return { status: 200, body: { entries: filtered, cursor: newCursor, backCursor: null, hasMore: entries.length >= lines } };
  }

  const files = findLogFiles(projectPath, prefix);
  if (files.length === 0) return { status: 200, body: { entries: [], cursor: null, backCursor: null, hasMore: false } };

  const { entries, latestFile, byteOffset, backCursorDate, backCursorOffset } = await readLastEntriesMultiFile(
    files, lines, after, before, instanceFilter, grepRe,
  );
  const filtered = filterLevel(entries);
  const date = latestFile ? dateFromLogFile(latestFile) || "" : "";
  const resCursor = encodeCursor(date, [byteOffset]);
  const backCursor = backCursorDate ? encodeCursor(backCursorDate, [backCursorOffset]) : null;
  return { status: 200, body: { entries: filtered, cursor: resCursor, backCursor, hasMore: false } };
}

export function registerLogRoutes(app: Hono, projectPath: string): void {
  // ── Scheduler logs ────────────────────────────────────────────────────────
  app.get("/api/logs/scheduler", async (c) => {
    const { status, body } = await handleLogRequest(projectPath, "scheduler", c.req.query());
    return c.json(body, status as any);
  });

  // ── Agent logs (all instances in one file) ─────────────────────────────
  app.get("/api/logs/agents/:name", async (c) => {
    const name = c.req.param("name");
    if (!SAFE_AGENT_NAME.test(name)) return c.json({ error: "Invalid agent name" }, 400);
    const { status, body } = await handleLogRequest(projectPath, name, c.req.query());
    return c.json(body, status as any);
  });

  // ── Specific instance logs (filter by instance field) ─────────────────
  app.get("/api/logs/agents/:name/:instanceId", async (c) => {
    const name = c.req.param("name");
    const instanceId = c.req.param("instanceId");
    if (!SAFE_AGENT_NAME.test(name)) return c.json({ error: "Invalid agent name" }, 400);
    if (!SAFE_AGENT_NAME.test(instanceId)) return c.json({ error: "Invalid instance ID" }, 400);
    const { status, body } = await handleLogRequest(projectPath, name, c.req.query(), instanceId);
    return c.json(body, status as any);
  });
}
