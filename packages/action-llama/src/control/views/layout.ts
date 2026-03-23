export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function formatTime(date: Date | null): string {
  if (!date) return "\u2014";
  return date.toLocaleTimeString();
}

export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n === 0) return "0";
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface LayoutOptions {
  title: string;
  breadcrumbs?: Breadcrumb[];
  content: string;
  scripts?: string;
}

export function renderLayout(opts: LayoutOptions): string {
  const { title, breadcrumbs, content, scripts } = opts;

  const breadcrumbHtml = breadcrumbs?.length
    ? `<nav class="flex items-center gap-1.5 text-sm text-slate-400 mb-4">
        ${breadcrumbs
          .map((b, i) => {
            const isLast = i === breadcrumbs.length - 1;
            if (isLast) return `<span class="text-slate-200 font-medium">${escapeHtml(b.label)}</span>`;
            return `<a href="${b.href || "#"}" class="hover:text-slate-200 transition-colors">${escapeHtml(b.label)}</a><span class="text-slate-600">/</span>`;
          })
          .join("\n        ")}
      </nav>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} \u2014 Action Llama</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['SF Mono', 'Fira Code', 'monospace'],
      }
    }
  }
};
</script>
<style>
  .state-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
  .scrollbar-thin::-webkit-scrollbar { width: 6px; }
  .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
  .scrollbar-thin::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
</style>
</head>
<body class="bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 min-h-screen">
  <header class="border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3">
    <div class="flex items-center justify-between">
      <a href="/dashboard" class="text-lg font-bold text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Action Llama</a>
      <div class="flex items-center gap-3">
        <button id="theme-toggle" onclick="toggleTheme()" class="p-1.5 rounded-md text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" title="Toggle theme">
          <svg id="theme-icon-dark" class="w-4 h-4 hidden dark:block" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
          <svg id="theme-icon-light" class="w-4 h-4 block dark:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
        </button>
        <a href="#" onclick="doLogout(); return false;" class="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">Logout</a>
      </div>
    </div>
  </header>

  <main class="px-4 sm:px-6 py-4 max-w-7xl mx-auto">
    ${breadcrumbHtml}
    ${content}
  </main>

  <script>
    // Theme management
    function getTheme() {
      return localStorage.getItem('al-theme') || 'dark';
    }
    function applyTheme(theme) {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      localStorage.setItem('al-theme', theme);
    }
    function toggleTheme() {
      applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
    }
    applyTheme(getTheme());

    // Shared helpers
    function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
    function fmtDur(ms) {
      if (ms < 1000) return ms + "ms";
      var s = Math.floor(ms / 1000);
      if (s < 60) return s + "s";
      var m = Math.floor(s / 60);
      if (m < 60) return m + "m " + (s % 60) + "s";
      var h = Math.floor(m / 60);
      return h + "h " + (m % 60) + "m";
    }
    function fmtTime(iso) {
      if (!iso) return "\\u2014";
      return new Date(iso).toLocaleTimeString();
    }
    function fmtCost(usd) {
      if (!usd || usd === 0) return "$0.00";
      if (usd < 0.01) return "$" + usd.toFixed(4);
      return "$" + usd.toFixed(2);
    }
    function fmtTokens(n) {
      if (!n || n === 0) return "0";
      if (n < 1000) return "" + n;
      if (n < 1000000) return (n / 1000).toFixed(1) + "k";
      return (n / 1000000).toFixed(2) + "M";
    }
    function ctrlPost(path) {
      return fetch(path, { method: "POST", credentials: "same-origin" }).then(function(r) { return r.json(); });
    }
    function doLogout() {
      fetch("/logout", { method: "POST", credentials: "same-origin" }).then(function() {
        window.location.href = "/login";
      });
    }
  </script>
  ${scripts || ""}
</body>
</html>`;
}
