---
"@action-llama/action-llama": minor
---

Replace shell-init-based environment persistence with an explicit `al-export` command. Agents now persist values with `al-export NAME value` and must source `. "$(al-export -f)"` in later shell commands instead of relying on implicit `setenv`/`BASH_ENV` behavior.
