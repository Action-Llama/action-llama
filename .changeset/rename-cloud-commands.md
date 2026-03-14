---
"@action-llama/action-llama": patch
---

Renamed CLI commands for better consistency. The cloud setup and teardown commands 
have been restructured from `al cloud setup`/`al cloud teardown` to 
`al setup cloud`/`al teardown cloud`. This change provides a more logical command 
hierarchy and better aligns with potential future setup/teardown operations for 
other infrastructure types. Closes #80.