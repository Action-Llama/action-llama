---
"@action-llama/action-llama": patch
---

Fix webhook and cron setup when agent is re-enabled (scale 0→N transition). Previously, when an agent config had scale=0 and was later changed to scale>0, webhooks and cron jobs were not created. Now handleChangedAgent() properly detects the 0→N and N→0 transitions and sets up or tears down resources accordingly.
