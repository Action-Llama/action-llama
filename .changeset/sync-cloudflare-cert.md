---
"@action-llama/action-llama": patch
---

Fix `al push` failing when `cloudflareHostname` is set: the Cloudflare origin certificate was not synced to the remote server during credential sync, causing nginx configuration to fail with "No such file or directory". The certificate is now included as an infrastructure credential during the sync phase.
