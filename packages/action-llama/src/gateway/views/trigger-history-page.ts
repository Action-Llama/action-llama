import type { TriggerHistoryRow } from "../../stats/store.js";
import { escapeHtml, renderLayout } from "./layout.js";

function triggerTypeBadge(type: string): string {
  const colors: Record<string, string> = {
    schedule: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    webhook: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
    agent: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  };
  const cls = colors[type] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  return `<span class="px-1.5 py-0.5 text-xs font-medium rounded ${cls}">${escapeHtml(type)}</span>`;
}

function resultBadge(result: string): string {
  if (result === "completed" || result === "rerun") {
    return `<span class="text-green-600 dark:text-green-400 text-xs font-medium">${escapeHtml(result)}</span>`;
  }
  if (result === "dead-letter") {
    return `<span class="px-1.5 py-0.5 text-xs font-medium rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">Dead Letter</span>`;
  }
  if (result === "error") {
    return `<span class="text-red-600 dark:text-red-400 text-xs font-medium">error</span>`;
  }
  return `<span class="text-slate-500 text-xs">${escapeHtml(result)}</span>`;
}

function renderRow(row: TriggerHistoryRow): string {
  const time = new Date(row.ts).toLocaleString();
  const agentLink = row.agentName
    ? `<a href="/dashboard/agents/${escapeHtml(row.agentName)}" class="text-blue-600 dark:text-blue-400 hover:underline text-sm">${escapeHtml(row.agentName)}</a>`
    : `<span class="text-slate-400 text-sm">\u2014</span>`;
  const instanceLink = row.instanceId && row.agentName
    ? `<a href="/dashboard/agents/${escapeHtml(row.agentName)}/instances/${escapeHtml(row.instanceId)}" class="text-sm text-slate-500 dark:text-slate-400 hover:underline font-mono">${escapeHtml(row.instanceId.slice(0, 12))}</a>`
    : `<span class="text-slate-400 text-sm">\u2014</span>`;
  return `<tr class="hover:bg-slate-50 dark:hover:bg-slate-900/50">
    <td class="px-3 py-2 text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">${escapeHtml(time)}</td>
    <td class="px-3 py-2">${triggerTypeBadge(row.triggerType)}</td>
    <td class="px-3 py-2 text-sm text-slate-600 dark:text-slate-300">${escapeHtml(row.triggerSource ?? "\u2014")}</td>
    <td class="px-3 py-2">${agentLink}</td>
    <td class="px-3 py-2">${instanceLink}</td>
    <td class="px-3 py-2">${resultBadge(row.result)}</td>
  </tr>`;
}

export interface TriggerHistoryPageOpts {
  rows: TriggerHistoryRow[];
  total: number;
  page: number;
  limit: number;
  includeDeadLetters: boolean;
}

export function renderTriggerHistoryPage(opts: TriggerHistoryPageOpts): string {
  const { rows, total, page, limit, includeDeadLetters } = opts;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const deadLetterParam = includeDeadLetters ? "1" : "0";

  const paginationLinks: string[] = [];
  if (page > 1) {
    paginationLinks.push(`<a href="/dashboard/triggers?page=${page - 1}&all=${deadLetterParam}" class="px-3 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200">Prev</a>`);
  }
  paginationLinks.push(`<span class="text-sm text-slate-500 dark:text-slate-400">Page ${page} of ${totalPages}</span>`);
  if (page < totalPages) {
    paginationLinks.push(`<a href="/dashboard/triggers?page=${page + 1}&all=${deadLetterParam}" class="px-3 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200">Next</a>`);
  }

  const content = `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div class="flex items-center gap-3">
        <a href="/dashboard" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">&larr;</a>
        <h1 class="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">Trigger History</h1>
      </div>
      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" ${includeDeadLetters ? "checked" : ""}
          onchange="window.location.href='/dashboard/triggers?page=1&all=' + (this.checked ? '1' : '0')"
          class="rounded border-slate-300 dark:border-slate-600">
        <span class="text-sm text-slate-600 dark:text-slate-300">Show dead letters</span>
      </label>
    </div>

    <div class="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden mb-4">
      <table class="w-full">
        <thead>
          <tr class="border-b border-slate-200 dark:border-slate-700">
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Timestamp</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Type</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Source</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Agent</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Instance</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
          ${rows.length > 0 ? rows.map(renderRow).join("\n") : '<tr><td colspan="6" class="px-3 py-8 text-center text-slate-400 italic">No triggers found</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="flex items-center justify-center gap-3">
      ${paginationLinks.join("\n")}
    </div>`;

  return renderLayout({ title: "Trigger History", content });
}
