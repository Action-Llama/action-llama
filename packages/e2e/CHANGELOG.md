# @action-llama/e2e

## 0.1.2

### Patch Changes

- [`9553f6b`](https://github.com/Action-Llama/action-llama/commit/9553f6bccb9a7d95044c73f835ee19859f845ed8) Thanks [@asselstine](https://github.com/asselstine)! - Fix E2E tests to use per-agent config.toml for runtime fields (models, credentials, schedule) instead of SKILL.md frontmatter metadata, matching the new config system. Also fix browser SSE test selector to match the updated navbar connection indicator.

## 0.1.1

### Patch Changes

- [`79c08a2`](https://github.com/Action-Llama/action-llama/commit/79c08a2fa58434787791162a1ba6c766c14911ec) Thanks [@asselstine](https://github.com/asselstine)! - Fix e2e VPS SSH authentication failures caused by bad ownership on bind-mounted
  authorized_keys file. The public key is now written directly inside the container
  via `docker exec` instead of bind-mounting from the host, ensuring correct
  ownership and permissions regardless of host environment.
