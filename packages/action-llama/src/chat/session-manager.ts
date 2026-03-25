/**
 * Manages active chat sessions with cap enforcement and idle tracking.
 */

import { randomUUID } from "crypto";
import type { ChatSession } from "./types.js";

const DEFAULT_MAX_SESSIONS = 5;

export class ChatSessionManager {
  private sessions = new Map<string, ChatSession>();
  private maxSessions: number;

  constructor(maxSessions?: number) {
    this.maxSessions = maxSessions ?? DEFAULT_MAX_SESSIONS;
  }

  canCreateSession(): boolean {
    return this.sessions.size < this.maxSessions;
  }

  createSession(agentName: string): ChatSession {
    if (!this.canCreateSession()) {
      throw new Error(`Chat session limit reached (max ${this.maxSessions})`);
    }
    const session: ChatSession = {
      sessionId: randomUUID(),
      agentName,
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  getSession(sessionId: string): ChatSession | undefined {
    return this.sessions.get(sessionId);
  }

  removeSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  touchSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = new Date();
    }
  }

  setContainerName(sessionId: string, containerName: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.containerName = containerName;
    }
  }

  setShutdownSecret(sessionId: string, secret: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.shutdownSecret = secret;
    }
  }

  getSessionByAgent(agentName: string): ChatSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.agentName === agentName) return session;
    }
    return undefined;
  }

  /** Returns sessions that have been idle longer than the given timeout. */
  getIdleSessions(timeoutMs: number): ChatSession[] {
    const cutoff = Date.now() - timeoutMs;
    const idle: ChatSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.lastActivityAt.getTime() < cutoff) {
        idle.push(session);
      }
    }
    return idle;
  }

  listSessions(): ChatSession[] {
    return [...this.sessions.values()];
  }

  get size(): number {
    return this.sessions.size;
  }
}
