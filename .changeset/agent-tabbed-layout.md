---
"@action-llama/frontend": minor
---

Refactor agent pages into a tabbed layout with Activity, Stats, and Settings tabs. The agent header (name, state, Run/Kill buttons) is now shared via a new AgentLayout component and stays fixed across all tabs. This eliminates the page title jumping issue and provides cleaner navigation. The /admin route now redirects to /settings.
