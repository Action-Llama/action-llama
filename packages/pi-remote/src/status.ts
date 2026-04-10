/**
 * Status bar text formatting for remote bindings.
 */

import type { RemoteEntry } from "./config.js";

/** Format the status bar text for the current remote binding. */
export function formatStatusText(name: string, entry: RemoteEntry): string {
  const typeLabel = formatTypeLabel(entry.type);
  return `Remote: ${name} (${typeLabel})`;
}

/** Format a remote type as a human-readable label. */
function formatTypeLabel(type: RemoteEntry["type"]): string {
  switch (type) {
    case "container": return "container";
    case "ssh": return "SSH";
    case "host-user": return "host-user";
    default: return type;
  }
}
