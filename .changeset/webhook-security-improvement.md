---
"@action-llama/action-llama": patch
---

Improve webhook security by denying unsigned webhooks by default. Previously, webhook sources without credentials would automatically accept unsigned requests. Now they are denied by default unless `allowUnsigned: true` is explicitly set in the webhook configuration. When `allowUnsigned: true` is used, a security warning is displayed on startup. This prevents accidental insecure production deployments while maintaining backward compatibility through the explicit opt-in flag.

Closes #225.