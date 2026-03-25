import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../lib/api";

export function LoginPage() {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setLoading(true);
      try {
        const ok = await login(key);
        if (ok) {
          navigate("/dashboard");
        } else {
          setError("Invalid API key");
        }
      } catch {
        setError("Login failed");
      } finally {
        setLoading(false);
      }
    },
    [key, navigate],
  );

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 w-full max-w-sm mx-4">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white text-center mb-2">
          Action Llama
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm text-center mb-6">
          Enter your API key to access the dashboard
        </p>
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-400 text-center">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <label
            htmlFor="key"
            className="block text-sm text-slate-500 dark:text-slate-400 mb-1.5"
          >
            API Key
          </label>
          <input
            type="password"
            id="key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste your gateway API key"
            autoFocus
            required
            className="w-full px-3 py-2.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-200 text-base outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-4 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? "Logging in..." : "Log in"}
          </button>
        </form>
        <p className="text-slate-400 dark:text-slate-500 text-xs text-center mt-4">
          Key is stored at
          ~/.action-llama/credentials/gateway_api_key/default/key
        </p>
      </div>
    </div>
  );
}
