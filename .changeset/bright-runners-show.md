---
"@action-llama/action-llama": patch
---

TUI and web dashboard now display agent scale and running instance count. Agents with
`scale > 1` show "Running 2/3" when active and "Idle (×3)" when idle, giving visibility
into how many parallel runners are busy. Scale-1 agents display as before.
