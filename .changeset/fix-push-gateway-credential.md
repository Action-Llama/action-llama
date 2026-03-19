---
"@action-llama/action-llama": patch
---

Fixed `al push` deployments crashing on startup with "Unknown credential gateway_api_key".
The gateway API key is auto-generated and not in the credential registry, but
`collectCredentialRefs` was feeding it into `doctor`'s `resolveCredential()` which
only knows about user-prompted credentials. Implicit credentials are now added
only in the push sync path, not in the doctor validation path.
