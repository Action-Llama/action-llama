import { useState, useEffect, useRef } from "react";

const DEFAULT_PROMPT =
  "Summarize these logs: what the agent operated on, what it did, and any errors. Keep it under 30 words.";

export function SummarizeModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (prompt: string) => void;
}) {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = () => {
    onSubmit(prompt.trim());
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-slate-900 shadow-xl border-slate-200 dark:border-slate-700 w-full h-full sm:h-auto sm:max-w-md sm:mx-4 sm:rounded-lg sm:border p-5 flex flex-col">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
          Summarize Logs
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          This prompt is appended after the logs.
        </p>
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter a prompt..."
          rows={4}
          className="w-full px-3 py-2 text-base bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none flex-1 sm:flex-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
          }}
        />
        <div className="flex items-center justify-end gap-2 mt-3">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!prompt.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            Summarize
          </button>
        </div>
      </div>
    </div>
  );
}
