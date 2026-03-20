---
"@action-llama/action-llama": patch
---

Restructure web dashboard with Tailwind CSS, light/dark mode, and three-level hierarchy.

The dashboard now has three levels: top-level overview, agent detail (with paginated instance history and aggregate stats from StatsStore), and instance detail (with run metadata, token breakdown, and live log viewer). Removed redundant Mode, Runtime, and Uptime stats from the top-level header. Added `/api/stats/agents/:name/runs` and `/api/stats/agents/:name/runs/:instanceId` endpoints for paginated run history. Old `/dashboard/agents/:name/logs` URLs redirect to the new agent detail page.
