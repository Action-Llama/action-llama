import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { createChatSession, deleteChatSession, clearChatSession } from "../lib/chat-api";
import { useChatSocket, type ChatMessage as ChatMessageType } from "../hooks/useChatSocket";
import { ChatMessage } from "../components/ChatMessage";
import { ToolBlock } from "../components/ToolBlock";

export function ChatPage() {
  const { agent } = useParams<{ agent: string }>();
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { messages, connected, containerReady, sendMessage, cancel, resetMessages } = useChatSocket(sessionId);

  // Create or reconnect to existing session on mount (idempotent per agent)
  useEffect(() => {
    if (!agent) return;
    let cancelled = false;

    createChatSession(agent)
      .then(({ sessionId }) => {
        if (!cancelled) setSessionId(sessionId);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [agent]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [input]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    sendMessage(text);
    setInput("");
  }, [input, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleClear = useCallback(async () => {
    if (!sessionId) return;
    try {
      const { sessionId: newId } = await clearChatSession(sessionId);
      resetMessages();
      setSessionId(newId);
    } catch (err: any) {
      setError(err.message);
    }
  }, [sessionId, resetMessages]);

  const handleShutdown = useCallback(async () => {
    if (!sessionId) return;
    try {
      await deleteChatSession(sessionId);
      navigate(`/dashboard/agents/${encodeURIComponent(agent || "")}`);
    } catch (err: any) {
      setError(err.message);
    }
  }, [sessionId, agent, navigate]);

  const isStreaming = messages.some((m) => m.role === "assistant" && !m.done);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <Link to="/dashboard" className="text-blue-400 hover:underline">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-800">
        <div className="flex items-center gap-3">
          <Link
            to={`/dashboard/agents/${encodeURIComponent(agent || "")}`}
            className="text-slate-400 hover:text-white transition-colors"
          >
            &larr;
          </Link>
          <h1 className="text-lg font-semibold">Chat: {agent}</h1>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              connected ? (containerReady ? "bg-green-400" : "bg-yellow-400") : "bg-red-400"
            }`}
          />
          <span className="text-xs text-slate-400">
            {connected
              ? containerReady
                ? "Connected"
                : "Waiting for agent..."
              : "Disconnected"}
          </span>
          <button
            onClick={handleClear}
            disabled={!sessionId}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-yellow-600 hover:bg-yellow-700 disabled:opacity-40 text-white transition-colors"
          >
            Clear Context
          </button>
          <button
            onClick={handleShutdown}
            disabled={!sessionId}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white transition-colors"
          >
            Shutdown
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center text-slate-500 mt-20">
            {containerReady
              ? "Send a message to start chatting."
              : "Waiting for agent container to start..."}
          </div>
        )}
        {messages.map((msg) =>
          msg.role === "tool_start" || msg.role === "tool_result" ? (
            <ToolBlock key={msg.id} message={msg} />
          ) : (
            <ChatMessage key={msg.id} message={msg} />
          ),
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-700 bg-slate-800 px-4 py-3">
        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isStreaming ? "Agent is responding..." : "Type a message..."}
            disabled={!connected}
            rows={1}
            className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-base text-white placeholder-slate-400 resize-none focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          {isStreaming ? (
            <button
              onClick={cancel}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || !connected}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
            >
              Send
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-1 text-center">
          Enter to send, Shift+Enter for newline
        </p>
      </div>
    </div>
  );
}
