import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { logout } from "../lib/api";
import { StatusStreamProvider, useStatusStream } from "../hooks/StatusStreamContext";

function getTheme(): string {
  return localStorage.getItem("al-theme") || "dark";
}

function applyTheme(theme: string) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem("al-theme", theme);
}

function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { connected } = useStatusStream();
  const [theme, setTheme] = useState(getTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    navigate("/login");
  }, [navigate]);

  const isSettings = location.pathname === "/dashboard/config";
  const isTriggers = location.pathname === "/triggers";
  const isJobs = location.pathname === "/jobs";

  return (
    <header className="border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            to="/dashboard"
            className="text-lg font-bold text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            Action Llama
          </Link>
          <Link
            to="/triggers"
            className={`flex items-center gap-1.5 text-sm transition-colors ${
              isTriggers
                ? "text-blue-600 dark:text-blue-400"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Triggers
          </Link>
          <Link
            to="/jobs"
            className={`flex items-center gap-1.5 text-sm transition-colors ${
              isJobs
                ? "text-blue-600 dark:text-blue-400"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Jobs
          </Link>
          <Link
            to="/dashboard/config"
            className={`flex items-center gap-1.5 text-sm transition-colors ${
              isSettings
                ? "text-blue-600 dark:text-blue-400"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            Settings
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`}
            title={connected ? "Connected" : "Disconnected"}
          />
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Toggle theme"
          >
            {theme === "dark" ? (
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
            ) : (
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
              </svg>
            )}
          </button>
          <button
            onClick={handleLogout}
            className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}

export function Layout() {
  return (
    <StatusStreamProvider>
      <Navbar />
      <main className="px-4 sm:px-6 py-4 max-w-7xl mx-auto">
        <Outlet />
      </main>
    </StatusStreamProvider>
  );
}
