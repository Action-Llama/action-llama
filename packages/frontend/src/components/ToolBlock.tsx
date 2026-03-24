import { useState } from "react";
import type { ChatMessage } from "../hooks/useChatSocket";

export function ToolBlock({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const isResult = message.role === "tool_result";
  const isError = message.error;

  return (
    <div className="mb-2 ml-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-md w-full text-left transition-colors ${
          isError
            ? "bg-red-900/30 border border-red-800 text-red-300 hover:bg-red-900/50"
            : "bg-slate-800 border border-slate-700 text-slate-400 hover:bg-slate-750"
        }`}
      >
        <span className={`transition-transform ${expanded ? "rotate-90" : ""}`}>
          &#9656;
        </span>
        <span className="font-semibold text-slate-300">
          {message.toolName || "tool"}
        </span>
        <span className="text-slate-500">
          {isResult ? (isError ? "error" : "done") : "running..."}
        </span>
      </button>
      {expanded && (
        <pre className="mt-1 ml-5 p-2 bg-slate-900 border border-slate-800 rounded text-xs text-slate-400 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">
          {message.text.slice(0, 5000)}
        </pre>
      )}
    </div>
  );
}
