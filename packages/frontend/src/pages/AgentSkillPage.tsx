import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getAgentSkill } from "../lib/api";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(text: string): string {
  let result = escapeHtml(text);

  // Inline code
  result = result.replace(
    /`([^`]+)`/g,
    '<code class="bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded text-sm font-mono">$1</code>',
  );

  // Links
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">$1</a>',
  );

  // Bold
  result = result.replace(
    /\*\*([^*]+)\*\*/g,
    '<strong class="font-semibold">$1</strong>',
  );

  // Italic
  result = result.replace(
    /\*([^*]+)\*/g,
    '<em class="italic">$1</em>',
  );

  return result;
}

function renderMarkdown(content: string): string {
  if (!content) return "";

  const lines = content.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;
  let codeBlockLanguage = "";
  let currentList: { type: "ul" | "ol"; items: string[] } | null = null;

  function closeCurrentList() {
    if (currentList) {
      const listClass =
        currentList.type === "ul"
          ? "list-disc list-inside mb-4 space-y-1"
          : "list-decimal list-inside mb-4 space-y-1";
      result.push(`<${currentList.type} class="${listClass}">`);
      for (const item of currentList.items) {
        result.push(`<li class="ml-2">${renderInline(item)}</li>`);
      }
      result.push(`</${currentList.type}>`);
      currentList = null;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code blocks
    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        result.push("</code></pre>");
        inCodeBlock = false;
        codeBlockLanguage = "";
      } else {
        closeCurrentList();
        codeBlockLanguage = trimmed.slice(3).trim();
        const langClass = codeBlockLanguage
          ? ` language-${escapeHtml(codeBlockLanguage)}`
          : "";
        result.push(
          `<pre class="bg-slate-100 dark:bg-slate-900 rounded-lg p-4 overflow-x-auto text-sm"><code${langClass ? ` class="${langClass}"` : ""}>`,
        );
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      result.push(escapeHtml(line));
      continue;
    }

    // Empty lines
    if (!trimmed) {
      closeCurrentList();
      result.push("<br>");
      continue;
    }

    // Headers
    if (trimmed.startsWith("#")) {
      closeCurrentList();
      const headerMatch = trimmed.match(/^(#+)\s+(.+)$/);
      if (headerMatch) {
        const level = Math.min(headerMatch[1].length, 6);
        const text = headerMatch[2];
        const sizeClass =
          level === 1
            ? "text-2xl"
            : level === 2
              ? "text-xl"
              : level === 3
                ? "text-lg"
                : "text-base";
        result.push(
          `<h${level} class="${sizeClass} font-bold text-slate-900 dark:text-white mt-6 mb-3">${renderInline(text)}</h${level}>`,
        );
      }
      continue;
    }

    // Lists
    const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);

    if (ulMatch) {
      if (!currentList || currentList.type !== "ul") {
        closeCurrentList();
        currentList = { type: "ul", items: [] };
      }
      currentList.items.push(ulMatch[1]);
      continue;
    }

    if (olMatch) {
      if (!currentList || currentList.type !== "ol") {
        closeCurrentList();
        currentList = { type: "ol", items: [] };
      }
      currentList.items.push(olMatch[1]);
      continue;
    }

    // Regular paragraph
    closeCurrentList();
    if (trimmed) {
      result.push(
        `<p class="mb-4 leading-relaxed">${renderInline(trimmed)}</p>`,
      );
    }
  }

  if (inCodeBlock) {
    result.push("</code></pre>");
  }
  closeCurrentList();

  return result.join("\n");
}

export function AgentSkillPage() {
  const { name } = useParams<{ name: string }>();
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!name) return;
    getAgentSkill(name)
      .then((d) => setBody(d.body))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load skill"),
      );
  }, [name]);

  if (!name) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            to={`/dashboard/agents/${encodeURIComponent(name)}`}
            className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              {name}
            </h1>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              SKILL.md
            </div>
          </div>
        </div>
        <Link
          to={`/dashboard/agents/${encodeURIComponent(name)}`}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
        >
          Back to Agent
        </Link>
      </div>

      {/* Content */}
      {error ? (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      ) : body === null ? (
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-8 text-center text-slate-500 dark:text-slate-400">
          Loading...
        </div>
      ) : (
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
          <div
            className="prose prose-slate dark:prose-invert max-w-none text-sm text-slate-700 dark:text-slate-300"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
          />
        </div>
      )}
    </div>
  );
}
