function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderLoginPage(error?: string): string {
  const errorHtml = error
    ? `<div class="error">${escapeHtml(error)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Login \u2014 Action Llama</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .login-box { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 32px; width: 100%; max-width: 380px; margin: 16px; }
  h1 { font-size: 1.4rem; margin-bottom: 8px; color: #f8fafc; text-align: center; }
  .subtitle { color: #94a3b8; font-size: 0.85rem; text-align: center; margin-bottom: 24px; }
  label { display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 6px; }
  input[type="password"] {
    width: 100%; padding: 10px 12px; background: #0f172a; border: 1px solid #334155; border-radius: 6px;
    color: #e2e8f0; font-size: 0.95rem; outline: none; transition: border-color 0.15s;
  }
  input[type="password"]:focus { border-color: #60a5fa; }
  button {
    width: 100%; padding: 10px; margin-top: 16px; background: #3b82f6; color: #fff; border: none;
    border-radius: 6px; font-size: 0.95rem; font-weight: 500; cursor: pointer; transition: background 0.15s;
  }
  button:hover { background: #2563eb; }
  .error { background: #7f1d1d40; border: 1px solid #ef4444; border-radius: 6px; padding: 8px 12px; margin-bottom: 16px; font-size: 0.85rem; color: #fca5a5; text-align: center; }
  .hint { color: #64748b; font-size: 0.75rem; text-align: center; margin-top: 16px; }
</style>
</head>
<body>
  <div class="login-box">
    <h1>Action Llama</h1>
    <div class="subtitle">Enter your API key to access the dashboard</div>
    ${errorHtml}
    <form method="POST" action="/login">
      <label for="key">API Key</label>
      <input type="password" id="key" name="key" placeholder="Paste your gateway API key" autofocus required>
      <button type="submit">Log in</button>
    </form>
    <div class="hint">Key is stored at ~/.action-llama/credentials/gateway_api_key/default/key</div>
  </div>
</body>
</html>`;
}
