---
"@action-llama/action-llama": patch
---

Ship `AGENTS.md` as part of the npm package. New projects created with `al new`
now get a symlink to the installed package's `AGENTS.md` instead of an inline
copy, so the reference stays up to date when the package is upgraded.
