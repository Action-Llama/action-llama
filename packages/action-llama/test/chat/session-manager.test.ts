import { describe, it, expect, beforeEach, vi } from "vitest";
import { ChatSessionManager } from "../../src/chat/session-manager.js";

describe("ChatSessionManager", () => {
  let manager: ChatSessionManager;

  beforeEach(() => {
    manager = new ChatSessionManager(3);
  });

  describe("createSession", () => {
    it("creates a session with unique ID", () => {
      const s1 = manager.createSession("agent-a");
      const s2 = manager.createSession("agent-b");
      expect(s1.sessionId).toBeTruthy();
      expect(s2.sessionId).toBeTruthy();
      expect(s1.sessionId).not.toBe(s2.sessionId);
    });

    it("sets agentName and timestamps", () => {
      const session = manager.createSession("my-agent");
      expect(session.agentName).toBe("my-agent");
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActivityAt).toBeInstanceOf(Date);
      expect(session.containerName).toBeUndefined();
    });

    it("throws when session limit is reached", () => {
      manager.createSession("a1");
      manager.createSession("a2");
      manager.createSession("a3");
      expect(() => manager.createSession("a4")).toThrow("session limit reached");
    });
  });

  describe("canCreateSession", () => {
    it("returns true when under limit", () => {
      expect(manager.canCreateSession()).toBe(true);
      manager.createSession("a1");
      expect(manager.canCreateSession()).toBe(true);
    });

    it("returns false when at limit", () => {
      manager.createSession("a1");
      manager.createSession("a2");
      manager.createSession("a3");
      expect(manager.canCreateSession()).toBe(false);
    });
  });

  describe("getSession", () => {
    it("returns session by ID", () => {
      const created = manager.createSession("agent-x");
      const found = manager.getSession(created.sessionId);
      expect(found).toBe(created);
    });

    it("returns undefined for unknown ID", () => {
      expect(manager.getSession("nonexistent")).toBeUndefined();
    });
  });

  describe("removeSession", () => {
    it("removes a session by ID", () => {
      const session = manager.createSession("agent-x");
      expect(manager.removeSession(session.sessionId)).toBe(true);
      expect(manager.getSession(session.sessionId)).toBeUndefined();
    });

    it("returns false for unknown ID", () => {
      expect(manager.removeSession("nonexistent")).toBe(false);
    });

    it("frees a slot for new sessions", () => {
      const s1 = manager.createSession("a1");
      manager.createSession("a2");
      manager.createSession("a3");
      expect(manager.canCreateSession()).toBe(false);

      manager.removeSession(s1.sessionId);
      expect(manager.canCreateSession()).toBe(true);
    });
  });

  describe("touchSession", () => {
    it("updates lastActivityAt", async () => {
      const session = manager.createSession("agent-x");
      const originalTime = session.lastActivityAt.getTime();

      await new Promise((r) => setTimeout(r, 10));
      manager.touchSession(session.sessionId);

      expect(session.lastActivityAt.getTime()).toBeGreaterThan(originalTime);
    });

    it("does nothing for unknown ID", () => {
      manager.touchSession("nonexistent");
      expect(manager.size).toBe(0);
    });
  });

  describe("setContainerName", () => {
    it("sets container name on session", () => {
      const session = manager.createSession("agent-x");
      manager.setContainerName(session.sessionId, "container-abc");
      expect(session.containerName).toBe("container-abc");
    });

    it("does nothing for unknown session", () => {
      const session = manager.createSession("agent-x");
      manager.setContainerName("nonexistent", "container-abc");
      expect(session.containerName).toBeUndefined();
    });
  });

  describe("getIdleSessions", () => {
    it("returns sessions idle longer than timeout", async () => {
      const s1 = manager.createSession("agent-a");
      await new Promise((r) => setTimeout(r, 30));
      manager.createSession("agent-b"); // fresh session

      const idle = manager.getIdleSessions(20);
      expect(idle).toHaveLength(1);
      expect(idle[0].sessionId).toBe(s1.sessionId);
    });

    it("returns empty when no sessions are idle", () => {
      manager.createSession("agent-a");
      const idle = manager.getIdleSessions(60_000);
      expect(idle).toHaveLength(0);
    });

    it("returns empty when no sessions exist", () => {
      expect(manager.getIdleSessions(1000)).toEqual([]);
    });
  });

  describe("listSessions", () => {
    it("returns all sessions", () => {
      manager.createSession("a1");
      manager.createSession("a2");
      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.agentName)).toEqual(["a1", "a2"]);
    });

    it("returns a copy (not the internal collection)", () => {
      manager.createSession("a1");
      const list = manager.listSessions();
      list.push({} as any);
      expect(manager.listSessions()).toHaveLength(1);
    });
  });

  describe("size", () => {
    it("tracks session count", () => {
      expect(manager.size).toBe(0);
      const s1 = manager.createSession("a1");
      expect(manager.size).toBe(1);
      manager.createSession("a2");
      expect(manager.size).toBe(2);
      manager.removeSession(s1.sessionId);
      expect(manager.size).toBe(1);
    });
  });

  describe("default maxSessions", () => {
    it("defaults to 5 when no limit specified", () => {
      const defaultManager = new ChatSessionManager();
      for (let i = 0; i < 5; i++) {
        defaultManager.createSession(`agent-${i}`);
      }
      expect(() => defaultManager.createSession("overflow")).toThrow("session limit reached");
    });
  });

  describe("getSessionByAgent", () => {
    it("returns session matching agent name", () => {
      const session = manager.createSession("target-agent");
      const found = manager.getSessionByAgent("target-agent");
      expect(found).toBe(session);
    });

    it("returns undefined when no session exists for agent", () => {
      expect(manager.getSessionByAgent("nonexistent-agent")).toBeUndefined();
    });

    it("returns undefined when sessions exist but for different agents", () => {
      manager.createSession("agent-a");
      manager.createSession("agent-b");
      expect(manager.getSessionByAgent("agent-c")).toBeUndefined();
    });

    it("returns the correct session when multiple sessions exist", () => {
      manager.createSession("agent-a");
      const target = manager.createSession("agent-b");
      const found = manager.getSessionByAgent("agent-b");
      expect(found).toBe(target);
    });
  });

  describe("setShutdownSecret", () => {
    it("stores the secret on the session", () => {
      const session = manager.createSession("agent-x");
      manager.setShutdownSecret(session.sessionId, "my-secret-123");
      expect(session.shutdownSecret).toBe("my-secret-123");
    });

    it("does nothing for unknown session", () => {
      const session = manager.createSession("agent-x");
      manager.setShutdownSecret("nonexistent", "my-secret");
      expect(session.shutdownSecret).toBeUndefined();
    });
  });
});
