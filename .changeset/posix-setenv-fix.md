---
"@action-llama/action-llama": patch
---

Fix `setenv` not working in host-user runtimes where only `/bin/sh` (BusyBox/dash) is available. Rewrote `al-bash-init.sh` using POSIX-only syntax (no bash arrays, no `[[ =~ ]]`, no `printf %q`) so it works under any `/bin/sh`. Also added `sh` compatibility tests to prevent regression. Closes #525.
