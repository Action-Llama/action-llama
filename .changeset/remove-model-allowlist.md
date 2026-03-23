---
"@action-llama/action-llama": patch
---

Remove hardcoded model name allowlist that blocked valid newer models (e.g. Claude 4.x).
Model names are now validated by the provider API at runtime instead of a stale local list.
Also fix agent config validation to match the actual SKILL.md frontmatter structure,
where `credentials` and `models` are nested under `metadata`.
