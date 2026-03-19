---
"@action-llama/action-llama": patch
---

Allow agents to hold multiple resource locks simultaneously and detect deadlock cycles.
The previous one-lock-per-holder restriction has been removed. When the scheduler detects
a cycle in the wait-for graph (e.g. agent A holds X and wants Y while agent B holds Y
and wants X), `rlock` returns a `possible deadlock` error with the cycle path, allowing
agents to release locks and back off without being killed. Closes #158.
