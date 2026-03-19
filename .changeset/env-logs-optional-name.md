---
"@action-llama/action-llama": patch
---

Made the environment name parameter optional for the `al env logs` command. When no environment is specified, the command now uses the configured environment from `.env.toml` or the `AL_ENV` environment variable, consistent with other AL commands that support environment resolution. Closes #136.