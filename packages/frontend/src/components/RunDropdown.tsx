import { useRef, useState, useEffect } from "react";

interface RunDropdownProps {
  disabled?: boolean;
  onQuickRun: () => void;
  onRunWithPrompt: () => void;
  onChat: () => void;
}

export function RunDropdown({ disabled, onQuickRun, onRunWithPrompt, onChat }: RunDropdownProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  return (
    <div className="relative inline-flex" ref={menuRef}>
      {/* Primary Run button */}
      <button
        onClick={onQuickRun}
        disabled={disabled}
        className="px-3 py-1.5 text-xs font-medium rounded-l-md bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
      >
        Run
      </button>
      {/* Caret / dropdown toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="px-1.5 py-1.5 text-xs font-medium rounded-r-md bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors border-l border-green-700"
        aria-label="More run options"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {/* Dropdown menu */}
      {open && (
        <div className="absolute right-0 mt-8 w-40 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg z-10 py-1">
          <button
            onClick={() => { setOpen(false); onRunWithPrompt(); }}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            Run with Prompt
          </button>
          <button
            onClick={() => { setOpen(false); onChat(); }}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            Chat
          </button>
        </div>
      )}
    </div>
  );
}
