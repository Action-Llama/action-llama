import { escapeHtml } from "./layout.js";

export function renderLoginPage(error?: string): string {
  const errorHtml = error
    ? `<div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-400 text-center">${escapeHtml(error)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Login \u2014 Action Llama</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = { darkMode: 'class' };
</script>
</head>
<body class="bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 flex items-center justify-center min-h-screen">
  <div class="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 w-full max-w-sm mx-4">
    <h1 class="text-2xl font-bold text-slate-900 dark:text-white text-center mb-2">Action Llama</h1>
    <p class="text-slate-500 dark:text-slate-400 text-sm text-center mb-6">Enter your API key to access the dashboard</p>
    ${errorHtml}
    <form method="POST" action="/login">
      <label for="key" class="block text-sm text-slate-500 dark:text-slate-400 mb-1.5">API Key</label>
      <input type="password" id="key" name="key" placeholder="Paste your gateway API key" autofocus required
        class="w-full px-3 py-2.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-200 text-sm outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors">
      <button type="submit"
        class="w-full mt-4 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
        Log in
      </button>
    </form>
    <p class="text-slate-400 dark:text-slate-500 text-xs text-center mt-4">Key is stored at ~/.action-llama/credentials/gateway_api_key/default/key</p>
  </div>
  <script>
    // Apply saved theme
    var theme = localStorage.getItem('al-theme') || 'dark';
    document.documentElement.classList.toggle('dark', theme === 'dark');
  </script>
</body>
</html>`;
}
