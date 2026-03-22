---
"@action-llama/action-llama": patch
---

Improved credential security in Docker runtime by reducing file permissions from overly permissive (0755/0644) to more restrictive (0700/0400). Added support for setting container UID/GID ownership and basic tmpfs credential mounting strategy for enhanced security on multi-user systems. Closes #224.