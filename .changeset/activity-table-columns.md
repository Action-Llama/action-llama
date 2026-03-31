---
"@action-llama/frontend": patch
---

Restructure activity table from two columns (Time, Description) to three columns (Time, Trigger, Agent). The Trigger column shows the trigger badge component, and the Agent column shows the colored instance ID linked to the instance detail page. Dead letters omit the agent column. On mobile the agent instance ID stacks underneath the trigger.
