import type { Hono } from "hono";
import {
  SAFE_AGENT_NAME,
  findLatestLogFile,
  dateFromLogFile,
  readEntriesForward,
  readLastEntries,
  encodeCursor,
  decodeCursor,
  parseQueryParams,
} from "./log-helpers.js";

export function registerLogRoutes(app: Hono, projectPath: string): void {
  // ── Scheduler logs ────────────────────────────────────────────────────────
  app.get("/api/logs/scheduler", async (c) => {
    const { lines, cursor, after, before, grep } = parseQueryParams(c.req.query());
    let grepRe: RegExp | undefined;
    if (grep) {
      try { grepRe = new RegExp(grep); }
      catch { return c.json({ error: "Invalid grep pattern" }, 400); }
    }

    if (cursor) {
      const parsed = decodeCursor(cursor);
      if (!parsed) return c.json({ error: "Invalid cursor" }, 400);

      const file = findLatestLogFile(projectPath, "scheduler");
      if (!file) return c.json({ entries: [], cursor: null, hasMore: false });

      const currentDate = dateFromLogFile(file);
      // If date rolled over, read from start of new file
      const offset = currentDate !== parsed.date ? 0 : parsed.offsets[0] || 0;
      const { entries, newOffset } = await readEntriesForward(file, offset, lines, after, before, undefined, grepRe);
      const newCursor = encodeCursor(currentDate || parsed.date, [newOffset]);
      return c.json({ entries, cursor: newCursor, hasMore: entries.length >= lines });
    }

    const file = findLatestLogFile(projectPath, "scheduler");
    if (!file) return c.json({ entries: [], cursor: null, hasMore: false });

    const { entries, byteOffset } = await readLastEntries(file, lines, after, before, undefined, grepRe);
    const date = dateFromLogFile(file) || "";
    const resCursor = encodeCursor(date, [byteOffset]);
    return c.json({ entries, cursor: resCursor, hasMore: false });
  });

  // ── Agent logs (all instances in one file) ─────────────────────────────
  app.get("/api/logs/agents/:name", async (c) => {
    const name = c.req.param("name");
    if (!SAFE_AGENT_NAME.test(name)) return c.json({ error: "Invalid agent name" }, 400);

    const { lines, cursor, after, before, grep } = parseQueryParams(c.req.query());
    let grepRe: RegExp | undefined;
    if (grep) {
      try { grepRe = new RegExp(grep); }
      catch { return c.json({ error: "Invalid grep pattern" }, 400); }
    }

    const file = findLatestLogFile(projectPath, name);
    if (!file) return c.json({ entries: [], cursor: null, hasMore: false });

    if (cursor) {
      const parsed = decodeCursor(cursor);
      if (!parsed) return c.json({ error: "Invalid cursor" }, 400);
      const currentDate = dateFromLogFile(file);
      const offset = currentDate !== parsed.date ? 0 : parsed.offsets[0] || 0;
      const { entries, newOffset } = await readEntriesForward(file, offset, lines, after, before, undefined, grepRe);
      const newCursor = encodeCursor(currentDate || parsed.date, [newOffset]);
      return c.json({ entries, cursor: newCursor, hasMore: entries.length >= lines });
    }

    const { entries, byteOffset } = await readLastEntries(file, lines, after, before, undefined, grepRe);
    const date = dateFromLogFile(file) || "";
    return c.json({ entries, cursor: encodeCursor(date, [byteOffset]), hasMore: false });
  });

  // ── Specific instance logs (filter by instance field) ─────────────────
  app.get("/api/logs/agents/:name/:instanceId", async (c) => {
    const name = c.req.param("name");
    const instanceId = c.req.param("instanceId");
    if (!SAFE_AGENT_NAME.test(name)) return c.json({ error: "Invalid agent name" }, 400);
    if (!SAFE_AGENT_NAME.test(instanceId)) return c.json({ error: "Invalid instance ID" }, 400);

    const { lines, cursor, after, before, grep } = parseQueryParams(c.req.query());
    let grepRe: RegExp | undefined;
    if (grep) {
      try { grepRe = new RegExp(grep); }
      catch { return c.json({ error: "Invalid grep pattern" }, 400); }
    }
    const instanceFilter = instanceId;

    const file = findLatestLogFile(projectPath, name);
    if (!file) return c.json({ entries: [], cursor: null, hasMore: false });

    if (cursor) {
      const parsed = decodeCursor(cursor);
      if (!parsed) return c.json({ error: "Invalid cursor" }, 400);
      const currentDate = dateFromLogFile(file);
      const offset = currentDate !== parsed.date ? 0 : parsed.offsets[0] || 0;
      const { entries, newOffset } = await readEntriesForward(file, offset, lines, after, before, instanceFilter, grepRe);
      const newCursor = encodeCursor(currentDate || parsed.date, [newOffset]);
      return c.json({ entries, cursor: newCursor, hasMore: entries.length >= lines });
    }

    const { entries, byteOffset } = await readLastEntries(file, lines, after, before, instanceFilter, grepRe);
    const date = dateFromLogFile(file) || "";
    return c.json({ entries, cursor: encodeCursor(date, [byteOffset]), hasMore: false });
  });
}
