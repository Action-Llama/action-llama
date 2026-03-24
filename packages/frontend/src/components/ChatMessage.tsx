import type { ChatMessage as ChatMessageType } from "../hooks/useChatSocket";

export function ChatMessage({ message }: { message: ChatMessageType }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[80%] bg-blue-600 text-white rounded-2xl rounded-br-sm px-4 py-2 text-sm whitespace-pre-wrap">
          {message.text}
        </div>
      </div>
    );
  }

  if (message.role === "assistant") {
    return (
      <div className="flex justify-start mb-3">
        <div className="max-w-[80%] bg-slate-700 text-slate-100 rounded-2xl rounded-bl-sm px-4 py-2 text-sm whitespace-pre-wrap">
          {message.text}
          {!message.done && (
            <span className="inline-block w-2 h-4 bg-slate-400 animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>
      </div>
    );
  }

  if (message.role === "error") {
    return (
      <div className="flex justify-start mb-3">
        <div className="max-w-[80%] bg-red-900/50 border border-red-700 text-red-200 rounded-lg px-4 py-2 text-sm">
          {message.text}
        </div>
      </div>
    );
  }

  return null;
}
