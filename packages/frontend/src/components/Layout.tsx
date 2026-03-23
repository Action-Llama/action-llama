import { Outlet, Link, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { logout } from "../lib/api";

function getTheme(): string {
  return localStorage.getItem("al-theme") || "dark";
}

function applyTheme(theme: string) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem("al-theme", theme);
}

export function Layout() {
  const navigate = useNavigate();
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

  return (
    <>
      <header className="border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between">
          <Link
            to="/dashboard"
            className="text-lg font-bold text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            Action Llama
          </Link>
          <div className="flex items-center gap-3">
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
      <main className="px-4 sm:px-6 py-4 max-w-7xl mx-auto">
        <Outlet />
      </main>
    </>
  );
}
