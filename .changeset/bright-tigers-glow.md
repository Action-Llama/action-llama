---
"@action-llama/action-llama": patch
"@action-llama/frontend": patch
---

Collapse "Instance" and "Trigger" columns into a single "Description" column in the activity table. Agent activity rows now show the agent name with the trigger badge underneath; dead letter rows show only the trigger. Webhook trigger badges now display detailed event info (e.g. "github issues opened" instead of just "github") by enriching activity rows with the webhook receipt's event summary.
