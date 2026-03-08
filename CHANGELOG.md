# @action-llama/action-llama

## 0.4.10

### Patch Changes

- [`f3b310f`](https://github.com/Action-Llama/action-llama/commit/f3b310fe89bab71e4b48b4bb047ed387b85e2976) Thanks [@asselstine](https://github.com/asselstine)! - Fixed daily release workflow: configured changelog-github plugin with repo name,
  switched to fully automatic publishing (no PR step), and adopted npm trusted
  publishing with OIDC and build provenance.

## 0.4.9

### Patch Changes

- [`c7de080`](https://github.com/Action-Llama/action-llama/commit/c7de0806433b54be09984c7c05bfeb35418d2ac1) Thanks [@asselstine](https://github.com/asselstine)! - Fixed daily release workflow: configured changelog-github plugin with repo name,
  switched to fully automatic publishing (no PR step), and adopted npm trusted
  publishing with OIDC and build provenance.

## 0.4.8

### Patch Changes

- [`661cd90`](https://github.com/Action-Llama/action-llama/commit/661cd90338f8199adac7f720f992989c1a93549c) Thanks [@asselstine](https://github.com/asselstine)! - Fixed daily release workflow: configured changelog-github plugin with repo name,
  switched to fully automatic publishing (no PR step), and adopted npm trusted
  publishing with OIDC and build provenance.

## 0.4.7

### Patch Changes

- [`5bb4b98`](https://github.com/Action-Llama/action-llama/commit/5bb4b98b06aba75779c2d7c63a6f45aa20aeb231) Thanks [@asselstine](https://github.com/asselstine)! - Fixed daily release workflow: configured changelog-github plugin with repo name,
  switched to fully automatic publishing (no PR step), and adopted npm trusted
  publishing with OIDC and build provenance.

## 0.4.6

### Patch Changes

- [`321349c`](https://github.com/Action-Llama/action-llama/commit/321349c563c84a5cd54ef35514fbfe46d5ad45f7) Thanks [@asselstine](https://github.com/asselstine)! - Fixed daily release workflow: configured changelog-github plugin with repo name,
  switched to fully automatic publishing (no PR step), and adopted npm trusted
  publishing with OIDC and build provenance.

## 0.4.5

### Patch Changes

- [`12607a6`](https://github.com/Action-Llama/action-llama/commit/12607a620c6eecc02aa48e912e10d2180784106e) Thanks [@asselstine](https://github.com/asselstine)! - Fixed daily release workflow: configured changelog-github plugin with repo name,
  switched to fully automatic publishing (no PR step), and adopted npm trusted
  publishing with OIDC and build provenance.

## 0.4.4

### Patch Changes

- [`c9ab51d`](https://github.com/Action-Llama/action-llama/commit/c9ab51d73ce4af153ce0c2455d70152675e312ad) Thanks [@asselstine](https://github.com/asselstine)! - Fixed daily release workflow: configured changelog-github plugin with repo name,
  switched to fully automatic publishing (no PR step), and adopted npm trusted
  publishing with OIDC and build provenance.

## 0.4.3

### Patch Changes

- [`7fb3eed`](https://github.com/Action-Llama/action-llama/commit/7fb3eedf2cc8a53830d2c373bdb576b280c83a09) Thanks [@asselstine](https://github.com/asselstine)! - Fixed a bug where git identity env vars (GIT_AUTHOR_NAME, etc.) set by one agent in host mode
  could contaminate other concurrently running agents. The env vars are now saved before each run
  and restored afterward.

- [`7fb3eed`](https://github.com/Action-Llama/action-llama/commit/7fb3eedf2cc8a53830d2c373bdb576b280c83a09) Thanks [@asselstine](https://github.com/asselstine)! - Webhook events are now queued instead of silently dropped when an agent is busy. After a run
  (including reruns) completes, the agent drains its queue before going idle. The queue is bounded
  per-agent (default 20) and configurable via `webhookQueueSize` in `config.toml`. Queue depth
  is visible in the TUI and dashboard.
