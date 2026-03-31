export function TriggerBadge({ label }: { label: string }) {
  // Determine color based on the first word (the trigger type/source)
  const key = label.split(" ")[0];
  const colors: Record<string, string> = {
    schedule:
      "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
    github:
      "bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
    sentry:
      "bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
    linear:
      "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400",
    slack:
      "bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400",
    discord:
      "bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400",
    twitter:
      "bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400",
    mintlify:
      "bg-teal-50 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400",
    manual:
      "bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-400",
    agent:
      "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
  };
  const cls =
    colors[key] ??
    "bg-slate-50 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400";
  return (
    <span
      className={`inline-block px-1.5 py-0 text-[10px] leading-4 font-medium rounded ${cls}`}
    >
      {label}
    </span>
  );
}

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

export function ResultBadge({ result, deadLetterReason }: { result: string; deadLetterReason?: string | null }) {
  if (result === "pending") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
        pending
      </span>
    );
  }
  if (result === "completed" || result === "rerun") {
    return (
      <span className="text-green-600 dark:text-green-400 text-xs font-medium">
        {result}
      </span>
    );
  }
  if (result === "dead-letter") {
    const reasonLabels: Record<string, string> = {
      no_match: "No Match",
      validation_failed: "Validation Failed",
      parse_error: "Parse Error",
    };
    const label = deadLetterReason ? (reasonLabels[deadLetterReason] ?? deadLetterReason) : "Dead Letter";
    return (
      <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
        {label}
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
