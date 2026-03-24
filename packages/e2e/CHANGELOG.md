# @action-llama/e2e

## 0.1.1

### Patch Changes

- [`79c08a2`](https://github.com/Action-Llama/action-llama/commit/79c08a2fa58434787791162a1ba6c766c14911ec) Thanks [@asselstine](https://github.com/asselstine)! - Fix e2e VPS SSH authentication failures caused by bad ownership on bind-mounted
  authorized_keys file. The public key is now written directly inside the container
  via `docker exec` instead of bind-mounting from the host, ensuring correct
  ownership and permissions regardless of host environment.
