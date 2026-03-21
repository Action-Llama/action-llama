---
"@action-llama/action-llama": patch
---

Added scale configuration controls to both TUI and web interface. Users can now:

- View and modify project-wide scale (max concurrent agent runs) in a new configuration page
- View and modify agent-specific scale (concurrent runners per agent) in agent configuration
- TUI: Press 'C' to open project config, 'A' to open agent config for the selected agent
- Web: Click "Config" button on dashboard to access project settings, agent scale controls on agent detail pages

Closes #203.