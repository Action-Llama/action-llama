---
"@action-llama/action-llama": patch
---

Fix TDZ crash on instance logs page caused by `loadOlderLogs` being referenced in a `useEffect` dependency array before its `const` declaration.
