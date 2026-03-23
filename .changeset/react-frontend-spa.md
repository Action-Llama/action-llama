---
"@action-llama/action-llama": patch
---

Replace the server-rendered HTML dashboard with a React SPA in a new `@action-llama/frontend` package (Vite, React 19, Tailwind CSS v4). The gateway serves the SPA with client-side routing and auth. All legacy HTML views (`src/control/views/`) are removed. On `al push`, the built frontend is deployed to the server and nginx serves static assets directly for efficiency.
