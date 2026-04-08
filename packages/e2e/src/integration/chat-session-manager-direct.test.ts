/**
 * Integration tests: chat/session-manager.ts ChatSessionManager — no Docker required.
 *
 * Tests all methods of ChatSessionManager directly without any network or Docker:
 *
 *   - constructor() default maxSessions=5
 *   - constructor() custom maxSessions
 *   - canCreateSession() true when below limit
 *   - canCreateSession() false at limit
 *   - createSession() returns ChatSession with sessionId/agentName/timestamps
 *   - createSession() throws when limit reached
 *   - getSession() found / undefined
 *   - removeSession() returns true for existing, false for unknown
 *   - touchSession() updates lastActivityAt / no-op for unknown id
 *   - setContainerName() sets containerName on session / no-op for unknown
 *   - setShutdownSecret() sets shutdownSecret on session / no-op for unknown
 *   - getSessionByAgent() finds first session for agent / undefined when absent
 *   - getIdleSessions() returns sessions idle longer than timeout / excludes recent
 *   - listSessions() returns all sessions as array
 *   - size property reflects current count
 *
 * Covers:
 *   - chat/session-manager.ts: ChatSessionManager — all public methods and properties
 */

import { describe, it, expect, vi } from "vitest";

const { ChatSessionManager } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/chat/session-manager.js"
);

describe(
  "integration: chat/session-manager.ts ChatSessionManager — no Docker required",
  { timeout: 10_000 },
  () => {
    // ── constructor ────────────────────────────────────────────────────────

    it("default maxSessions is 5 (canCreateSession true for first 5 sessions)", () => {
      const mgr = new ChatSessionManager();
      for (let i = 0; i < 5; i++) {
        expect(mgr.canCreateSession()).toBe(true);
        mgr.createSession("agent-" + i);
      }
      expect(mgr.canCreateSession()).toBe(false);
    });

    it("custom maxSessions=2 respected", () => {
      const mgr = new ChatSessionManager(2);
      expect(mgr.canCreateSession()).toBe(true);
      mgr.createSession("a");
      mgr.createSession("a");
      expect(mgr.canCreateSession()).toBe(false);
    });

    // ── canCreateSession ───────────────────────────────────────────────────

    it("canCreateSession() returns true when below limit", () => {
      const mgr = new ChatSessionManager(3);
      expect(mgr.canCreateSession()).toBe(true);
    });

    it("canCreateSession() returns false when at limit", () => {
      const mgr = new ChatSessionManager(1);
      mgr.createSession("my-agent");
      expect(mgr.canCreateSession()).toBe(false);
    });

    // ── createSession ──────────────────────────────────────────────────────

    it("createSession() returns ChatSession with sessionId UUID", () => {
      const mgr = new ChatSessionManager(5);
      const session = mgr.createSession("test-agent");
      expect(typeof session.sessionId).toBe("string");
      expect(session.sessionId.length).toBeGreaterThan(0);
    });

    it("createSession() returns session with correct agentName", () => {
      const mgr = new ChatSessionManager(5);
      const session = mgr.createSession("my-agent");
      expect(session.agentName).toBe("my-agent");
    });

    it("createSession() returns session with createdAt and lastActivityAt", () => {
      const mgr = new ChatSessionManager(5);
      const before = new Date();
      const session = mgr.createSession("test-agent");
      const after = new Date();
      expect(session.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(session.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(session.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it("createSession() throws when limit reached", () => {
      const mgr = new ChatSessionManager(1);
      mgr.createSession("agent-a");
      expect(() => mgr.createSession("agent-b")).toThrow(/session limit reached|max/i);
    });

    it("createSession() creates unique sessionIds for each call", () => {
      const mgr = new ChatSessionManager(5);
      const s1 = mgr.createSession("a");
      const s2 = mgr.createSession("b");
      expect(s1.sessionId).not.toBe(s2.sessionId);
    });

    // ── getSession ─────────────────────────────────────────────────────────

    it("getSession() returns session for valid sessionId", () => {
      const mgr = new ChatSessionManager(5);
      const created = mgr.createSession("test-agent");
      const retrieved = mgr.getSession(created.sessionId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.sessionId).toBe(created.sessionId);
    });

    it("getSession() returns undefined for unknown sessionId", () => {
      const mgr = new ChatSessionManager(5);
      expect(mgr.getSession("nonexistent-session-id")).toBeUndefined();
    });

    // ── removeSession ──────────────────────────────────────────────────────

    it("removeSession() returns true for existing session", () => {
      const mgr = new ChatSessionManager(5);
      const session = mgr.createSession("test-agent");
      expect(mgr.removeSession(session.sessionId)).toBe(true);
    });

    it("removeSession() returns false for unknown sessionId", () => {
      const mgr = new ChatSessionManager(5);
      expect(mgr.removeSession("nonexistent")).toBe(false);
    });

    it("removeSession() decrements size", () => {
      const mgr = new ChatSessionManager(5);
      const session = mgr.createSession("test-agent");
      expect(mgr.size).toBe(1);
      mgr.removeSession(session.sessionId);
      expect(mgr.size).toBe(0);
    });

    // ── touchSession ───────────────────────────────────────────────────────

    it("touchSession() updates lastActivityAt", async () => {
      const mgr = new ChatSessionManager(5);
      const session = mgr.createSession("test-agent");
      const before = session.lastActivityAt.getTime();

      // Wait a bit to ensure time difference
      await new Promise(r => setTimeout(r, 10));
      mgr.touchSession(session.sessionId);

      const updated = mgr.getSession(session.sessionId);
      expect(updated!.lastActivityAt.getTime()).toBeGreaterThan(before);
    });

    it("touchSession() is a no-op for unknown sessionId", () => {
      const mgr = new ChatSessionManager(5);
      // Should not throw
      expect(() => mgr.touchSession("nonexistent")).not.toThrow();
    });

    // ── setContainerName ───────────────────────────────────────────────────

    it("setContainerName() sets containerName on session", () => {
      const mgr = new ChatSessionManager(5);
      const session = mgr.createSession("test-agent");
      mgr.setContainerName(session.sessionId, "al-test-container-abc");
      const updated = mgr.getSession(session.sessionId);
      expect(updated!.containerName).toBe("al-test-container-abc");
    });

    it("setContainerName() is a no-op for unknown sessionId", () => {
      const mgr = new ChatSessionManager(5);
      // Should not throw
      expect(() => mgr.setContainerName("nonexistent", "container-xyz")).not.toThrow();
    });

    // ── setShutdownSecret ──────────────────────────────────────────────────

    it("setShutdownSecret() sets shutdownSecret on session", () => {
      const mgr = new ChatSessionManager(5);
      const session = mgr.createSession("test-agent");
      mgr.setShutdownSecret(session.sessionId, "secret-abc-123");
      const updated = mgr.getSession(session.sessionId);
      expect(updated!.shutdownSecret).toBe("secret-abc-123");
    });

    it("setShutdownSecret() is a no-op for unknown sessionId", () => {
      const mgr = new ChatSessionManager(5);
      // Should not throw
      expect(() => mgr.setShutdownSecret("nonexistent", "secret")).not.toThrow();
    });

    // ── getSessionByAgent ──────────────────────────────────────────────────

    it("getSessionByAgent() returns the first matching session", () => {
      const mgr = new ChatSessionManager(5);
      const session = mgr.createSession("target-agent");
      const found = mgr.getSessionByAgent("target-agent");
      expect(found).toBeDefined();
      expect(found!.sessionId).toBe(session.sessionId);
    });

    it("getSessionByAgent() returns undefined when no session matches", () => {
      const mgr = new ChatSessionManager(5);
      mgr.createSession("other-agent");
      expect(mgr.getSessionByAgent("nonexistent-agent")).toBeUndefined();
    });

    it("getSessionByAgent() ignores sessions for other agents", () => {
      const mgr = new ChatSessionManager(5);
      mgr.createSession("agent-a");
      const sessionB = mgr.createSession("agent-b");
      const found = mgr.getSessionByAgent("agent-b");
      expect(found!.sessionId).toBe(sessionB.sessionId);
    });

    // ── getIdleSessions ────────────────────────────────────────────────────

    it("getIdleSessions() returns sessions that have been idle longer than timeout", async () => {
      const mgr = new ChatSessionManager(5);
      const session = mgr.createSession("idle-agent");

      // Backdated lastActivityAt to make it appear idle
      // (We access the session object directly since we got a reference)
      const sessionObj = mgr.getSession(session.sessionId)!;
      (sessionObj as any).lastActivityAt = new Date(Date.now() - 10_000);

      const idleSessions = mgr.getIdleSessions(5_000); // 5s timeout
      expect(idleSessions).toHaveLength(1);
      expect(idleSessions[0].sessionId).toBe(session.sessionId);
    });

    it("getIdleSessions() excludes sessions with recent activity", async () => {
      const mgr = new ChatSessionManager(5);
      mgr.createSession("recent-agent"); // lastActivityAt = now

      const idleSessions = mgr.getIdleSessions(10_000); // 10s timeout - session is fresh
      expect(idleSessions).toHaveLength(0);
    });

    it("getIdleSessions() returns empty when no sessions", () => {
      const mgr = new ChatSessionManager(5);
      expect(mgr.getIdleSessions(1000)).toHaveLength(0);
    });

    // ── listSessions ───────────────────────────────────────────────────────

    it("listSessions() returns all sessions as array", () => {
      const mgr = new ChatSessionManager(5);
      const s1 = mgr.createSession("agent-a");
      const s2 = mgr.createSession("agent-b");
      const list = mgr.listSessions();
      expect(list).toHaveLength(2);
      const ids = list.map(s => s.sessionId);
      expect(ids).toContain(s1.sessionId);
      expect(ids).toContain(s2.sessionId);
    });

    it("listSessions() returns empty array when no sessions", () => {
      const mgr = new ChatSessionManager(5);
      expect(mgr.listSessions()).toHaveLength(0);
    });

    // ── size ───────────────────────────────────────────────────────────────

    it("size property reflects current session count", () => {
      const mgr = new ChatSessionManager(5);
      expect(mgr.size).toBe(0);
      mgr.createSession("a");
      expect(mgr.size).toBe(1);
      mgr.createSession("b");
      expect(mgr.size).toBe(2);
    });
  },
);
