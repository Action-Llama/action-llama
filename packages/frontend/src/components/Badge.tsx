const triggerColors: Record<string, string> = {
  schedule:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  webhook:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  agent:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

export function TriggerTypeBadge({ type }: { type: string }) {
  const cls =
    triggerColors[type] ??
    "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  return (
    <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${cls}`}>
      {type}
    </span>
  );
}

export function ResultBadge({ result }: { result: string }) {
  if (result === "completed" || result === "rerun") {
    return (
      <span className="text-green-600 dark:text-green-400 text-xs font-medium">
        {result}
      </span>
    );
  }
  if (result === "dead-letter") {
    return (
      <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
        Dead Letter
      </span>
    );
  }
  if (result === "error") {
    return (
      <span className="text-red-600 dark:text-red-400 text-xs font-medium">
        error
      </span>
    );
  }
  if (result === "running") {
    return (
      <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400 text-xs font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
        running
      </span>
    );
  }
  return <span className="text-slate-500 text-xs">{result}</span>;
}

export function StateBadge({ state }: { state: string }) {
  const colors: Record<string, { dot: string; text: string }> = {
    running: {
      dot: "bg-green-500",
      text: "text-green-600 dark:text-green-400",
    },
    building: {
      dot: "bg-yellow-500",
      text: "text-yellow-600 dark:text-yellow-400",
    },
    error: { dot: "bg-red-500", text: "text-red-600 dark:text-red-400" },
    idle: { dot: "bg-slate-400", text: "text-slate-500 dark:text-slate-400" },
  };
  const c = colors[state] ?? colors.idle;
  return (
    <span className={`${c.text} text-sm`}>
      <span className={`state-dot ${c.dot} mr-1.5 inline-block`} />
      {state}
    </span>
  );
}
