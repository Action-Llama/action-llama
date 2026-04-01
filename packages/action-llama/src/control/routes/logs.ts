import type { Hono } from "hono";
import {
  SAFE_AGENT_NAME,
  findLogFiles,
  dateFromLogFile,
  readLastEntriesMultiFile,
  readEntriesForwardMultiFile,
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
  let grepRe: RegExp | undefined;
  if (grep) {
    try { grepRe = new RegExp(grep); }
    catch { return { status: 400, body: { error: "Invalid grep pattern" } }; }
  }

  const filterLevel = (entries: LogEntry[]) =>
    minLevel > 0 ? entries.filter((e) => e.level >= minLevel) : entries;

  if (cursor) {
    const parsed = decodeCursor(cursor);
    if (!parsed) return { status: 400, body: { error: "Invalid cursor" } };

    const files = findLogFiles(projectPath, prefix);
    if (files.length === 0) return { status: 200, body: { entries: [], cursor: null, hasMore: false } };

    const { entries, newDate, newOffset } = await readEntriesForwardMultiFile(
      projectPath, prefix, parsed.date, parsed.offsets[0] || 0, lines,
      after, before, instanceFilter, grepRe,
    );
    const filtered = filterLevel(entries);
    const newCursor = encodeCursor(newDate, [newOffset]);
    return { status: 200, body: { entries: filtered, cursor: newCursor, hasMore: entries.length >= lines } };
  }

  const files = findLogFiles(projectPath, prefix);
  if (files.length === 0) return { status: 200, body: { entries: [], cursor: null, hasMore: false } };

  const { entries, latestFile, byteOffset } = await readLastEntriesMultiFile(
    files, lines, after, before, instanceFilter, grepRe,
  );
  const filtered = filterLevel(entries);
  const date = latestFile ? dateFromLogFile(latestFile) || "" : "";
  const resCursor = encodeCursor(date, [byteOffset]);
  return { status: 200, body: { entries: filtered, cursor: resCursor, hasMore: false } };
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
