---
name: status
description: Show a rich overview of the Action Llama project status including scheduler state and agent details. Use when checking status, health, or state of the project.
---

# Status overview

Show a rich overview of the Action Llama project status.

## Steps

1. Call `al_status` and `al_agents` in parallel to gather scheduler state and agent details.

2. Present a formatted overview:

   **Scheduler**: running/stopped, uptime, gateway URL

   **Agents**:
   | Agent | State | Trigger | Last Run | Next Run |
   |-------|-------|---------|----------|----------|
   | ...   | ...   | ...     | ...      | ...      |

   Include schedule expressions, webhook configs, and credential status for each agent.

3. Add actionable suggestions if relevant:
   - Agents that are paused or erroring
   - Agents that haven't run recently
   - Missing credentials flagged by `al_agents`
