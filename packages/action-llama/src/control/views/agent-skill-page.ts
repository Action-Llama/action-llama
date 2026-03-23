import { escapeHtml, renderLayout } from "./layout.js";
import { renderMarkdown } from "./markdown.js";

export function renderAgentSkillPage(agentName: string, skillBody: string): string {
  const content = `
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-3">
        <h1 class="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">${escapeHtml(agentName)} Skill</h1>
      </div>
      <div class="flex items-center gap-2">
        <a href="/dashboard/agents/${escapeHtml(agentName)}" class="px-3 py-1.5 text-sm rounded-md font-bold border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors">
          Back to Agent
        </a>
      </div>
    </div>

    <div class="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
      <div class="prose prose-slate dark:prose-invert max-w-none">
        ${skillBody ? renderMarkdown(skillBody) : '<p class="text-slate-500 dark:text-slate-400 italic">No skill content available.</p>'}
      </div>
    </div>
  `;

  return renderLayout({
    title: `${agentName} Skill`,
    breadcrumbs: [
      { label: "Dashboard", href: "/dashboard" },
      { label: agentName, href: `/dashboard/agents/${encodeURIComponent(agentName)}` },
      { label: "Skill" },
    ],
    content,
  });
}