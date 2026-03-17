---
"@action-llama/action-llama": patch
---

Fixed credential prompts exposing sensitive values in plain text. All custom credential
prompt flows (API keys, tokens, SSH private keys) now use masked password input instead
of plain text input, matching the behavior of the generic credential prompter.
