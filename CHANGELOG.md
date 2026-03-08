# @action-llama/action-llama

## 0.5.1

### Patch Changes

- [`e83e163`](https://github.com/Action-Llama/action-llama/commit/e83e163fdedecd027de3737aae9c25f0408b890b) Thanks [@asselstine](https://github.com/asselstine)! - Ship `AGENTS.md` as part of the npm package. New projects created with `al new`
  now get a symlink to the installed package's `AGENTS.md` instead of an inline
  copy, so the reference stays up to date when the package is upgraded.

- [`56fcc66`](https://github.com/Action-Llama/action-llama/commit/56fcc662e758b4819406bcbd0021c5138cc1e692) Thanks [@asselstine](https://github.com/asselstine)! - Added HTTP basic auth support for the web dashboard. Set the `AL_DASHBOARD_SECRET`
  environment variable to require authentication on all `/dashboard` routes. Uses
  timing-safe comparison to prevent timing attacks. When the env var is not set, the
  dashboard remains open (no auth required).

- [#35](https://github.com/Action-Llama/action-llama/pull/35) [`8759418`](https://github.com/Action-Llama/action-llama/commit/875941840fd0a32681803c8a74886e0c2a486692) Thanks [@asselstine](https://github.com/asselstine)! - Improved error messages for ECS IAM role assumption failures. When an agent fails to start because its task role doesn't exist or can't be assumed, Action Llama now provides clear instructions to run 'al doctor -c' to create the missing per-agent IAM roles. Closes [#34](https://github.com/Action-Llama/action-llama/issues/34).

## 0.5.0

### Minor Changes

- [`14a1301`](https://github.com/Action-Llama/action-llama/commit/14a13019b7e3dfc59d98ffd3d261bfc3ac064e8b) Thanks [@asselstine](https://github.com/asselstine)! - Webhook sources are now defined in the project's `config.toml` under `[webhooks.<name>]` instead of inline in each agent's `agent-config.toml`. Each source specifies a provider `type` and optional `credential` for HMAC validation. Agent webhook triggers now use `source = "<name>"` to reference a top-level webhook definition, replacing the old `type` and `source` (credential instance) fields. This is a breaking change to webhook configuration format.

### Patch Changes

- [`488e02c`](https://github.com/Action-Llama/action-llama/commit/488e02c6b2d23c83fe09dea8f383ec54e6998b0a) Thanks [@asselstine](https://github.com/asselstine)! - Added `al creds add <ref>` and `al creds rm <ref>` commands for managing individual
  credentials. `add` runs the interactive prompter with validation; `rm` deletes the
  credential from disk. Also improved `al creds ls` to group credentials by type with
  a human-readable label header.

## 0.4.12

### Patch Changes

- [`e990c2a`](https://github.com/Action-Llama/action-llama/commit/e990c2ae19a3ed549076a36ad9c46875ca27b06d) Thanks [@asselstine](https://github.com/asselstine)! - Fixed daily release workflow: configured changelog-github plugin with repo name,
  switched to fully automatic publishing (no PR step), and adopted npm trusted
  publishing with OIDC and build provenance.

## 0.4.11

### Patch Changes

- [`4dec55f`](https://github.com/Action-Llama/action-llama/commit/4dec55f0120c4a1d74a4f0a982ce595a2c374745) Thanks [@asselstine](https://github.com/asselstine)! - Fixed daily release workflow: configured changelog-github plugin with repo name,
  switched to fully automatic publishing (no PR step), and adopted npm trusted
  publishing with OIDC and build provenance.

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
