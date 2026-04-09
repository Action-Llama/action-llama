---
"@action-llama/action-llama": patch
---

Fix transport runner failing to call LLM for custom baseUrl models and multiple null-guard crashes.

- Fix custom model registration using wrong Pi SDK API type (`openai-chatcompletions` → `openai-completions`), which caused sessions to silently complete without calling the LLM
- Fix `credentials is not iterable` crashes when agent config has no credentials defined (null guards in credential-setup, prompt, transport-runner, credential-refs, scheduler validation)
- Fix `--no-config` flag for `al add` (Commander.js sets `config: false`, not `noConfig: true`)
- Fix host-user runtime staging credentials to `/credentials/` (root filesystem) instead of a temp directory
- Add `baseUrl` to allowed model config fields in validation schema
- Add error logging when Pi SDK session completes with `stopReason: "error"`
