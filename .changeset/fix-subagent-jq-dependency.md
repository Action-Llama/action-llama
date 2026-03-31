---
"@action-llama/action-llama": patch
---

Replace jq dependency in al-subagent and al-subagent-wait scripts with shell string concatenation, fixing test failures in environments without jq installed
