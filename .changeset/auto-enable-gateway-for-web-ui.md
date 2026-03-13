---
"@action-llama/action-llama": patch
---

The `-w` flag now automatically enables the gateway, eliminating the need to specify both `-g` and `-w` flags. Users can now simply use `al start -w` to enable the web dashboard. Closes #76.