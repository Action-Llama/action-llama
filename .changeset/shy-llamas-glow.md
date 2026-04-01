---
"@action-llama/action-llama": patch
---

Fix "Cannot access variable before initialization" error on agent page by extracting InstanceContext into a dedicated module, preventing bundler module-ordering TDZ issues.
