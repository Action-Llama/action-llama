---
"@action-llama/e2e": patch
---

Fix e2e VPS SSH authentication failures caused by bad ownership on bind-mounted
authorized_keys file. The public key is now written directly inside the container
via `docker exec` instead of bind-mounting from the host, ensuring correct
ownership and permissions regardless of host environment.
