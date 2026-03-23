import { escapeHtml } from "./layout.js";

/**
 * Simple markdown to HTML renderer.
 * Supports headers, lists, code blocks, links, and basic formatting.
 */
export function renderMarkdown(content: string): string {
  if (!content) return "";

  // Split into lines for processing
  const lines = content.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let codeBlockLanguage = '';
  let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code blocks
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        result.push('</code></pre>');
        inCodeBlock = false;
        codeBlockLanguage = '';
      } else {
        // Start code block
        closeCurrentList();
        codeBlockLanguage = trimmed.slice(3).trim();
        const langClass = codeBlockLanguage ? ` language-${escapeHtml(codeBlockLanguage)}` : '';
        result.push(`<pre class="bg-slate-100 dark:bg-slate-900 rounded-lg p-4 overflow-x-auto text-sm"><code${langClass ? ` class="${langClass}"` : ''}>`);
        inCodeBlock = true;
      }
      continue;
    }

    // If in code block, just add the line
    if (inCodeBlock) {
      result.push(escapeHtml(line));
      continue;
    }

    // Empty lines
    if (!trimmed) {
      closeCurrentList();
      result.push('<br>');
      continue;
    }

    // Headers
    if (trimmed.startsWith('#')) {
      closeCurrentList();
      const headerMatch = trimmed.match(/^(#+)\s+(.+)$/);
      if (headerMatch) {
        const level = Math.min(headerMatch[1].length, 6);
        const text = headerMatch[2];
        const sizeClass = level === 1 ? 'text-2xl' : level === 2 ? 'text-xl' : level === 3 ? 'text-lg' : 'text-base';
        result.push(`<h${level} class="${sizeClass} font-bold text-slate-900 dark:text-white mt-6 mb-3">${renderInline(text)}</h${level}>`);
      }
      continue;
    }

    // Lists
    const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    
    if (ulMatch) {
      if (!currentList || currentList.type !== 'ul') {
        closeCurrentList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(ulMatch[1]);
      continue;
    }

    if (olMatch) {
      if (!currentList || currentList.type !== 'ol') {
        closeCurrentList();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(olMatch[1]);
      continue;
    }

    // Regular paragraph
    closeCurrentList();
    if (trimmed) {
      result.push(`<p class="mb-4 leading-relaxed">${renderInline(trimmed)}</p>`);
    }
  }

  // Close any remaining code block or list
  if (inCodeBlock) {
    result.push('</code></pre>');
  }
  closeCurrentList();

  function closeCurrentList() {
    if (currentList) {
      const listClass = currentList.type === 'ul' 
        ? 'list-disc list-inside mb-4 space-y-1' 
        : 'list-decimal list-inside mb-4 space-y-1';
      result.push(`<${currentList.type} class="${listClass}">`);
      for (const item of currentList.items) {
        result.push(`<li class="ml-2">${renderInline(item)}</li>`);
      }
      result.push(`</${currentList.type}>`);
      currentList = null;
    }
  }

  return result.join('\n');
}

/**
 * Render inline markdown elements within a line (bold, italic, code, links)
 */
function renderInline(text: string): string {
  // Escape HTML first, before creating our own tags
  let result = escapeHtml(text);

  // Inline code
  result = result.replace(/`([^`]+)`/g, '<code class="bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded text-sm font-mono">$1</code>');

  // Links
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-600 dark:text-blue-400 hover:underline">$1</a>');

  // Bold
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold">$1</strong>');

  // Italic
  result = result.replace(/\*([^*]+)\*/g, '<em class="italic">$1</em>');

  return result;
}