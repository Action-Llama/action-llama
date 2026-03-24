/**
 * Ink-based terminal UI for ChatTransport.
 *
 * Used by `al chat <agent> --env <name>` (remote mode) to render
 * streaming chat in the terminal.
 */

import React, { useState, useEffect, useCallback } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import type { ChatTransport } from "./transport.js";
import type { ChatOutbound } from "./types.js";

interface Message {
  role: "user" | "assistant" | "tool" | "error";
  text: string;
  done?: boolean;
  toolName?: string;
}

function ChatApp({ transport, agentName }: { transport: ChatTransport; agentName: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const { exit } = useApp();

  useEffect(() => {
    const unsub = transport.onMessage((msg: ChatOutbound) => {
      switch (msg.type) {
        case "assistant_message":
          if (msg.done) {
            setStreaming(false);
            // Finalize the streaming message
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant" && !last.done) {
                return [...prev.slice(0, -1), { ...last, done: true }];
              }
              return prev;
            });
          } else {
            setStreaming(true);
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant" && !last.done) {
                return [...prev.slice(0, -1), { ...last, text: last.text + msg.text }];
              }
              return [...prev, { role: "assistant", text: msg.text, done: false }];
            });
          }
          break;

        case "tool_start":
          setMessages((prev) => [
            ...prev,
            { role: "tool", text: `[${msg.tool}] ${msg.input.slice(0, 200)}`, toolName: msg.tool },
          ]);
          break;

        case "tool_result":
          setMessages((prev) => [
            ...prev,
            {
              role: "tool",
              text: `[${msg.tool}] ${msg.error ? "ERROR: " : ""}${msg.output.slice(0, 500)}`,
              toolName: msg.tool,
            },
          ]);
          break;

        case "error":
          setMessages((prev) => [...prev, { role: "error", text: msg.message }]);
          setStreaming(false);
          break;

        case "heartbeat":
          // Ignore
          break;
      }
    });

    return unsub;
  }, [transport]);

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === "c") {
      if (streaming) {
        transport.send({ type: "cancel" });
        setStreaming(false);
      } else {
        transport.send({ type: "shutdown" });
        transport.close().then(() => exit());
      }
      return;
    }

    if (key.ctrl && inputChar === "d") {
      transport.send({ type: "shutdown" });
      transport.close().then(() => exit());
      return;
    }

    if (key.return) {
      if (input.trim() && !streaming) {
        const text = input.trim();
        setMessages((prev) => [...prev, { role: "user", text, done: true }]);
        setInput("");
        transport.send({ type: "user_message", text });
      }
      return;
    }

    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    if (inputChar && !key.ctrl && !key.meta) {
      setInput((prev) => prev + inputChar);
    }
  });

  // Show last N messages to avoid terminal overflow
  const visibleMessages = messages.slice(-30);

  return React.createElement(Box, { flexDirection: "column", padding: 1 },
    React.createElement(Text, { bold: true, color: "cyan" }, `Chat: ${agentName}`),
    React.createElement(Text, { dimColor: true }, "Ctrl+C = cancel/exit, Ctrl+D = exit"),
    React.createElement(Box, { flexDirection: "column", marginTop: 1 },
      ...visibleMessages.map((msg, i) => {
        switch (msg.role) {
          case "user":
            return React.createElement(Text, { key: i, color: "green" }, `> ${msg.text}`);
          case "assistant":
            return React.createElement(Text, { key: i, color: "white" }, msg.text);
          case "tool":
            return React.createElement(Text, { key: i, dimColor: true }, msg.text);
          case "error":
            return React.createElement(Text, { key: i, color: "red" }, `Error: ${msg.text}`);
        }
      }),
    ),
    React.createElement(Box, { marginTop: 1 },
      React.createElement(Text, { color: streaming ? "yellow" : "green" },
        streaming ? "(streaming...) " : "> ",
      ),
      React.createElement(Text, null, input),
      React.createElement(Text, { dimColor: true }, "\u2588"),
    ),
  );
}

export async function runChatTUI(transport: ChatTransport, agentName: string): Promise<void> {
  const app = render(
    React.createElement(ChatApp, { transport, agentName }),
  );
  await app.waitUntilExit();
}
