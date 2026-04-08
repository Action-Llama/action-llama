---
"@action-llama/action-llama": patch
---

Remove unreachable null-check guards in App.tsx handlers. The `handleProjectScaleUpdate` and `handleAgentScaleUpdate` handlers are only passed to child components that are rendered when `projectPath` is truthy, making the null-check throw statements dead code with zero coverage. Closes #575
