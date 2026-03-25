const BASE = "";

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "same-origin",
    ...init,
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface ChatSessionInfo {
  sessionId: string;
  agentName: string;
  containerName?: string;
  createdAt: string;
  lastActivityAt: string;
}

export function createChatSession(agentName: string): Promise<{ sessionId: string; created: boolean }> {
  return fetchJSON("/api/chat/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentName }),
  });
}

export function clearChatSession(sessionId: string): Promise<{ sessionId: string }> {
  return fetchJSON(`/api/chat/sessions/${encodeURIComponent(sessionId)}/clear`, {
    method: "POST",
  });
}

export function deleteChatSession(sessionId: string): Promise<{ success: boolean }> {
  return fetchJSON(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}

export function listChatSessions(): Promise<{ sessions: ChatSessionInfo[] }> {
  return fetchJSON("/api/chat/sessions");
}
