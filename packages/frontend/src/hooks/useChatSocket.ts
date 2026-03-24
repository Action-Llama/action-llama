import { useEffect, useRef, useState, useCallback } from "react";

export interface ChatOutbound {
  type: "assistant_message" | "tool_start" | "tool_result" | "error" | "heartbeat";
  text?: string;
  done?: boolean;
  toolCallId?: string;
  tool?: string;
  input?: string;
  output?: string;
  error?: boolean | string;
  message?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool_start" | "tool_result" | "error";
  text: string;
  done?: boolean;
  toolName?: string;
  toolCallId?: string;
  error?: boolean;
}

let msgCounter = 0;
function nextId(): string {
  return `msg-${++msgCounter}-${Date.now()}`;
}

export function useChatSocket(sessionId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [containerReady, setContainerReady] = useState(false);
  const streamingRef = useRef(false);

  useEffect(() => {
    if (!sessionId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/chat/ws/${sessionId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      let msg: ChatOutbound;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case "assistant_message":
          if (msg.done) {
            streamingRef.current = false;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant" && !last.done) {
                return [...prev.slice(0, -1), { ...last, done: true }];
              }
              return prev;
            });
          } else {
            if (!containerReady) setContainerReady(true);
            streamingRef.current = true;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant" && !last.done) {
                return [...prev.slice(0, -1), { ...last, text: last.text + (msg.text || "") }];
              }
              return [...prev, { id: nextId(), role: "assistant", text: msg.text || "", done: false }];
            });
          }
          break;

        case "tool_start":
          if (!containerReady) setContainerReady(true);
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "tool_start",
              text: msg.input || "",
              toolName: msg.tool,
              toolCallId: msg.toolCallId,
            },
          ]);
          break;

        case "tool_result":
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "tool_result",
              text: msg.output || "",
              toolName: msg.tool,
              toolCallId: msg.toolCallId,
              error: !!msg.error,
            },
          ]);
          break;

        case "error":
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "error", text: msg.message || "Unknown error" },
          ]);
          streamingRef.current = false;
          break;

        case "heartbeat":
          // Keep-alive, ignore
          break;
      }
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onerror = () => {
      setConnected(false);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId]);

  const sendMessage = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const userMsg: ChatMessage = { id: nextId(), role: "user", text, done: true };
    setMessages((prev) => [...prev, userMsg]);
    wsRef.current.send(JSON.stringify({ type: "user_message", text }));
  }, []);

  const cancel = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "cancel" }));
  }, []);

  return { messages, connected, containerReady, sendMessage, cancel };
}
