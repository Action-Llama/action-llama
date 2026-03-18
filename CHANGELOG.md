# @action-llama/action-llama

## 0.12.2

### Patch Changes

- [#120](https://github.com/Action-Llama/action-llama/pull/120) [`955f12e`](https://github.com/Action-Llama/action-llama/commit/955f12e5bcbff764a0a97610cc1a14556b423a38) Thanks [@asselstine](https://github.com/asselstine)! - Added support for Hetzner VPS provisioning alongside existing Vultr support.
  Users can now provision Hetzner Cloud servers via `al setup cloud` with the
  same Cloudflare HTTPS integration. Requires a `hetzner_api_key` credential.
  Closes [#119](https://github.com/Action-Llama/action-llama/issues/119).

- [`df60864`](https://github.com/Action-Llama/action-llama/commit/df60864fc11d1ae594ce50e6b15a59aa6901a13c) Thanks [@asselstine](https://github.com/asselstine)! - Fixed `-E`/`--env` flag being ignored by `al logs`, `al stat`, `al pause`, `al resume`,
  `al kill`, and `al chat` when connecting to the gateway. These commands always connected to
  `http://localhost:<port>` instead of using the `gateway.url` from the selected environment,
  so remote environments showed stale local data instead of live remote logs/status.

- [`d41e73d`](https://github.com/Action-Llama/action-llama/commit/d41e73d031e2a5b008a8563a3b56d60ce17ba888) Thanks [@asselstine](https://github.com/asselstine)! - Fixed container gateway URL fallback to use the nginx proxy (`http://gateway:8080`) on the
  Docker network instead of `host.docker.internal`, which doesn't resolve on Linux. This broke
  `rlock`, `runlock`, and other gateway-dependent commands inside containers on VPS deployments.

- [`31da42f`](https://github.com/Action-Llama/action-llama/commit/31da42fdca6cfaa336ecb7e2f085b80d9a8147ca) Thanks [@asselstine](https://github.com/asselstine)! - Fixed `al push` crash-looping on the remote server due to a missing environment file.
  The remote `.env.toml` no longer references a named environment; instead it inlines
  gateway and telemetry config directly, so the server runs self-contained without
  needing `~/.action-llama/environments/` on the remote.

- [`3a1ad19`](https://github.com/Action-Llama/action-llama/commit/3a1ad19763312d7ce277aef791552030e0588e3a) Thanks [@asselstine](https://github.com/asselstine)! - `al push` now configures nginx as a TLS reverse proxy using the Cloudflare Origin CA
  certificate created during provisioning. The gateway binds to localhost only — nginx
  terminates TLS on port 443 and forwards to the gateway. Removed `--expose` from the
  systemd unit since the gateway should not be directly reachable from the internet.

## 0.12.1

### Patch Changes

- [`c59262b`](https://github.com/Action-Llama/action-llama/commit/c59262b3be8d1c82c1df0b54cc700da32f16aea4) Thanks [@asselstine](https://github.com/asselstine)! - Default the Cloudflare subdomain prompt to "agents" during `al env prov`, so users
  can accept the common choice by pressing Enter.

- [`c944691`](https://github.com/Action-Llama/action-llama/commit/c9446910fd06c82b7672d7af0986c5b2cceac863) Thanks [@asselstine](https://github.com/asselstine)! - Fix remote deploy starting gateway on port 8080 instead of 3000. `al push` now passes
  `--port 3000` explicitly in the systemd unit's ExecStart command, and `al start` accepts
  a new `--port` flag to override the gateway port from the command line.

- [`e0d6a53`](https://github.com/Action-Llama/action-llama/commit/e0d6a539efd12d7718d2a26416ab67c48e73a0c9) Thanks [@asselstine](https://github.com/asselstine)! - `al push` now runs `npm install` on the remote server after syncing project files,
  ensuring dependencies (including `al` itself) stay up to date with each deploy.
  The `al` CLI is no longer installed globally on the server — it is resolved from
  the project's `node_modules/.bin/al` instead.

- [`4b0e4b3`](https://github.com/Action-Llama/action-llama/commit/4b0e4b336475c564b27ce355c4b77aa11d53f553) Thanks [@asselstine](https://github.com/asselstine)! - `al env deprov` no longer prompts for confirmation before deleting a Vultr instance.
  Since the environment is being deleted anyway, the extra prompt was unnecessary friction.

- [`54d8668`](https://github.com/Action-Llama/action-llama/commit/54d8668a3f62a3b6a8b9e0da08ca92426f713b07) Thanks [@asselstine](https://github.com/asselstine)! - Redesigned the web dashboard log viewer to match the CLI's conversation format.
  Logs now show assistant text, bash commands, tool invocations, and run lifecycle
  events with rich formatting and color instead of flat `TIME LEVEL msg` lines.

## 0.12.0

### Minor Changes

- [`bddd62d`](https://github.com/Action-Llama/action-llama/commit/bddd62d1d6260833153cbf4b67bb046cf0239d25) Thanks [@asselstine](https://github.com/asselstine)! - Removed AWS and GCP cloud system in favour of simpler VPS

- [`2cc4267`](https://github.com/Action-Llama/action-llama/commit/2cc42671c14405cb98045cc59ed99fa9b7ffe56a) Thanks [@asselstine](https://github.com/asselstine)! - Portable projects: three-layer config separation and agent-scoped credentials.

  **Config changes:**

  - Project config (`config.toml`) is now portable — cloud infrastructure details belong in environment files
  - Added `.env.toml` (gitignored) for per-project environment binding and config overrides
  - Added `~/.action-llama/environments/<name>.toml` for shared cloud infrastructure config
  - Config merge order: `config.toml` -> `.env.toml` -> environment file (later wins, deep merge)
  - `[cloud]` in `config.toml` emits a deprecation warning; move to an environment file

  **CLI changes:**

  - Replaced `-c`/`--cloud` flag with `-E`/`--env <name>` on all commands (start, run, doctor, stat, logs, kill, pause, resume, chat, cloud deploy)
  - Added `al env init <name>`, `al env list`, `al env show <name>` commands
  - Environment can also be set via `AL_ENV` env var or `.env.toml`'s `environment` field
  - Cloud mode is now auto-detected from the merged config (presence of `[cloud]` section)

  **Credential changes:**

  - Agent credentials now resolve with agent-specific -> default fallback (`type/<agent-name>/` then `type/default/`)
  - Cross-agent credential references: `credentials = ["other-agent/github_token"]`
  - Legacy `type:instance` syntax still works with a deprecation warning
  - `"default"` is now a reserved name and cannot be used as an agent name

  **Scaffolding:**

  - `al new` now adds `.env.toml` to `.gitignore`

- [#113](https://github.com/Action-Llama/action-llama/pull/113) [`04123f6`](https://github.com/Action-Llama/action-llama/commit/04123f65f68990d7d3fa54eab543a72f1ca2b28d) Thanks [@asselstine](https://github.com/asselstine)! - Added `al push` command for deploying to self-hosted servers via SSH. Configure a
  `[server]` section in an environment file with host, user, port, keyPath, and basePath,
  then run `al push --env <name>` to sync project files and credentials, install a systemd
  service running `al start --headless --expose`, and verify deployment with a health check.
  Supports `--dry-run` to preview changes and `--no-creds` to skip credential sync.

  Also changed `al env init` to require a `--type` flag (`server`, `ecs`, or `cloud-run`)
  instead of defaulting to ECS. Removed support for `[cloud]` in `config.toml` — cloud
  config must now be in an environment file.

### Patch Changes

- [`5254284`](https://github.com/Action-Llama/action-llama/commit/525428474d285993977523ecf44ae53015a9d898) Thanks [@asselstine](https://github.com/asselstine)! - The HTTP gateway now starts automatically with `al start` — the `--gateway` (`-g`) flag has been removed. This means `al pause`, `al resume`, `al kill`, and `al stop` work out of the box without needing to remember the flag. The `--expose` flag still controls whether the gateway binds to `0.0.0.0` (public) or `127.0.0.1` (local only, the default).

- [#118](https://github.com/Action-Llama/action-llama/pull/118) [`a280e15`](https://github.com/Action-Llama/action-llama/commit/a280e15e61a623cbe5833968ab02ac850910b8d5) Thanks [@asselstine](https://github.com/asselstine)! - Added `al creds types` to browse and search available credential types interactively,
  `al agent new` to create agents from built-in templates (dev, reviewer, devops) or a
  blank custom scaffold, and `al agent config <name>` to interactively edit an agent's
  credentials, model, schedule, webhooks, and params via a menu loop.

- [`570cf0c`](https://github.com/Action-Llama/action-llama/commit/570cf0ce4a9d170aaa695730bb509356ba839ca5) Thanks [@asselstine](https://github.com/asselstine)! - Added a dedicated "Initializing" TUI phase during Docker image builds. Instead of
  showing the full running view while images are still building, `al start` now displays
  a focused build progress screen with per-agent spinners and build step details, then
  transitions to the normal running TUI once all images are ready.

- [#118](https://github.com/Action-Llama/action-llama/pull/118) [`a280e15`](https://github.com/Action-Llama/action-llama/commit/a280e15e61a623cbe5833968ab02ac850910b8d5) Thanks [@asselstine](https://github.com/asselstine)! - Added `al env set`, `al env prov`, and `al env deprov` commands for binding projects to environments, provisioning VPS servers, and tearing them down. Provisioned servers now get a ufw firewall configured (SSH + gateway only). Removed the unused `al setup` command and dead `cloud-setup.ts` code.

- [`4ffacb1`](https://github.com/Action-Llama/action-llama/commit/4ffacb13c488b21e7e2ac970d0e3d7d896a09abb) Thanks [@asselstine](https://github.com/asselstine)! - Added optional Cloudflare HTTPS support to `al env prov`. When provisioning a new Vultr VPS,
  you can now opt in to Cloudflare HTTPS: the wizard collects your Cloudflare API token and
  hostname, then after the VPS is up it creates a proxied DNS record, generates an Origin CA
  certificate, installs nginx as a TLS-terminating reverse proxy, and sets the gateway URL to
  `https://<hostname>`. Deprovisioning with `al env deprov` automatically cleans up the DNS record.
  The existing plain HTTP flow is unchanged when you decline HTTPS.

- [`194171d`](https://github.com/Action-Llama/action-llama/commit/194171d658db97c126105dd8c9cb3213c1174437) Thanks [@asselstine](https://github.com/asselstine)! - Fixed container agents failing to read ACTIONS.md via the read tool. The container
  working directory was `/tmp` (an empty tmpfs mount), so file reads resolved there
  instead of `/app/static` where agent files are baked into the image. Changed cwd
  to `/app/static` and updated the prompt to instruct the LLM to write to `/tmp`.

- [`fd5fe2b`](https://github.com/Action-Llama/action-llama/commit/fd5fe2b49f28d67e723de04c233038fcb6180880) Thanks [@asselstine](https://github.com/asselstine)! - `al env prov` now checks for an existing Origin CA certificate before generating a new one. If a certificate already exists, it prompts whether to regenerate (default: No) instead of generating unconditionally and then asking whether to overwrite.

- [`0065a18`](https://github.com/Action-Llama/action-llama/commit/0065a18321a2e9c86775d2efe4f067c2760884f8) Thanks [@asselstine](https://github.com/asselstine)! - Removed hardcoded `--cpus 2` default from Docker container launch, fixing failures on
  single-CPU VPS instances. CPU limit is now only passed when explicitly set via `[local].cpus`
  in config. Also removed redundant `size=2g` tmpfs cap since `--memory` already bounds
  container memory usage.

- [`77e175f`](https://github.com/Action-Llama/action-llama/commit/77e175f3741964815f27fab20cfe6c05d83c2a5f) Thanks [@asselstine](https://github.com/asselstine)! - Added hot reload for `al start`. The scheduler now watches the `agents/` directory
  for changes and automatically reloads agent configs, rebuilds images, and updates
  cron/webhook schedules without restarting. Running containers finish with their old
  image; new runs use the updated image. Adding or removing agent directories is also
  detected automatically.

- [#111](https://github.com/Action-Llama/action-llama/pull/111) [`1f2130a`](https://github.com/Action-Llama/action-llama/commit/1f2130ad7e1d1fadc2de4a67c94746f151f15423) Thanks [@asselstine](https://github.com/asselstine)! - Added full integration test system with Docker and shell script agents. Test agents use
  bash scripts instead of LLMs inside real Docker containers, exercising the complete stack
  (image builds, gateway, webhooks, cron, control API, reruns, signals) at zero LLM cost.

  Production changes: fixed agent path bug in image builder (was missing `agents/` prefix),
  added `test-script.sh` baking into agent images when present, and added a `TestWebhookProvider`
  that skips HMAC validation for test webhooks.

- [#116](https://github.com/Action-Llama/action-llama/pull/116) [`b8a792c`](https://github.com/Action-Llama/action-llama/commit/b8a792ccf20e0a36bd63272feae977ad3d035a1e) Thanks [@asselstine](https://github.com/asselstine)! - Added optional `projectName` field to `.env.toml` for human-readable project identification.
  When set, the project name appears in the TUI header and in headless log output, making it
  easier to identify which project is running. `al new` now scaffolds `.env.toml` with
  `projectName` pre-populated from the project name.

- [`e77d3f9`](https://github.com/Action-Llama/action-llama/commit/e77d3f9f79d422c883e484a98557caf024faff32) Thanks [@asselstine](https://github.com/asselstine)! - Fixed outdated Dockerfile examples in `al chat` context and AGENTS.md that used
  `apt-get` (Debian) instead of `apk` (Alpine), matching the actual `node:20-alpine`
  base image. Also updated credential reference examples to use the current simple
  syntax (`"github_token"`) instead of the deprecated `"type:instance"` format, and
  corrected the base image tool list to include `jq`.

- [`80b195f`](https://github.com/Action-Llama/action-llama/commit/80b195f603366088dbf6b6c9b7bfab4be5432356) Thanks [@asselstine](https://github.com/asselstine)! - Removed `server.gatewayPort` config option. The remote gateway port is now
  always 3000 (`DEFAULT_GATEWAY_PORT`), matching what UFW, nginx, and Vultr
  firewall rules already assumed. Also removed the unused `AL_GATEWAY_PORT`
  environment variable from the systemd unit.

- [`db77a1c`](https://github.com/Action-Llama/action-llama/commit/db77a1c06978912b2eeb5050c1b55f24e45d32de) Thanks [@asselstine](https://github.com/asselstine)! - Fixed credential prompts exposing sensitive values in plain text. All custom credential
  prompt flows (API keys, tokens, SSH private keys) now use masked password input instead
  of plain text input, matching the behavior of the generic credential prompter.

- [#113](https://github.com/Action-Llama/action-llama/pull/113) [`04123f6`](https://github.com/Action-Llama/action-llama/commit/04123f65f68990d7d3fa54eab543a72f1ca2b28d) Thanks [@asselstine](https://github.com/asselstine)! - Separated unit and integration test suites using vitest projects. `npm run test:unit` runs
  only fast unit tests, `npm run test:integration` runs Docker-based integration tests with
  process isolation and 180s timeout, and `npm test` runs both. Watch mode is scoped to unit tests.

- [`7fd175b`](https://github.com/Action-Llama/action-llama/commit/7fd175bb1a6c593656869a65ce18938d0b45979f) Thanks [@asselstine](https://github.com/asselstine)! - Fixed VPS SSH key credential not being persisted during Vultr provisioning, and
  SSH polling using the wrong key path. When creating or selecting a vps_ssh
  credential, the keypair is now saved to the credential store and `sshKeyPath` is
  stored in the environment config so that SSH connections use the correct key.

  VPS cloud-init now installs Node.js 22.x LTS in addition to Docker, so
  `al push` no longer fails with "Node.js not found" on freshly provisioned
  servers. Running `al env prov` on an existing environment now verifies SSH,
  Node.js, and Docker readiness (installing Node.js automatically if missing)
  instead of silently skipping.

- [`3cb2364`](https://github.com/Action-Llama/action-llama/commit/3cb2364a4484f8d75421353445eafac68743d7d3) Thanks [@asselstine](https://github.com/asselstine)! - Increased integration test timeout from 3 minutes to 30 minutes to prevent
  timeouts in slower CI environments like GitHub Actions.

- [`132dc10`](https://github.com/Action-Llama/action-llama/commit/132dc101315cada0e7cbb909a13bbf25c0ae8ec4) Thanks [@asselstine](https://github.com/asselstine)! - `al push` now supports `--creds-only`, `--files-only`, and `--all` flags for selective syncing, and delegates config validation to `al doctor --check-only` instead of performing its own credential check. Bootstrap runs Node/Docker/al readiness checks in parallel and returns resolved binary paths (`BootstrapResult`); the generated systemd unit uses absolute paths for `al` and `node` with a proper `PATH` env var and `-w` flag. `al agent config` webhook setup now offers a credential picker (pick existing or add new) instead of raw text input. `al doctor` validates that webhook sources referenced by agents exist in config.toml, and health-check failures now display service status and recent logs for debugging.

- [`098fb0d`](https://github.com/Action-Llama/action-llama/commit/098fb0d7d05268f577d888dc8b8e587d04677dcc) Thanks [@asselstine](https://github.com/asselstine)! - Improved `al push` health check to handle slow first-time deployments. The health
  check now streams live journal output so you can see Docker image build progress,
  waits up to 3 minutes (was 12 seconds), and detects service crashes to fail fast
  instead of waiting for the full timeout.

- [`8dd81b0`](https://github.com/Action-Llama/action-llama/commit/8dd81b0a3b342fc56839bbf5b1e0e533970fdb37) Thanks [@asselstine](https://github.com/asselstine)! - Added `al env check <name>` to verify environment health (SSH, Node.js, Docker, Vultr firewall, Cloudflare DNS, nginx, SSL mode, gateway). Reports pass/fail for each check and suggests `al env prov <name>` to fix issues. Re-running `al env prov` on an existing environment now uses the same verification logic with auto-fix.

- [#117](https://github.com/Action-Llama/action-llama/pull/117) [`2b65a3d`](https://github.com/Action-Llama/action-llama/commit/2b65a3d3f1a26391f9f335e37208477160e37325) Thanks [@asselstine](https://github.com/asselstine)! - Added VPS cloud provider (`provider: "vps"`) for deploying agents to any server via SSH + Docker.
  Supports connecting to existing servers or provisioning new Vultr VPS instances. Images are built
  directly on the VPS via `tar | ssh docker build` — no container registry needed. Credentials are
  stored on the VPS filesystem over SSH.

- [#115](https://github.com/Action-Llama/action-llama/pull/115) [`7dfd50a`](https://github.com/Action-Llama/action-llama/commit/7dfd50aec35d9b7540141581683e70b0fe273be5) Thanks [@asselstine](https://github.com/asselstine)! - Added a gateway log API (`/api/logs/scheduler`, `/api/logs/agents/:name`, `/api/logs/agents/:name/:instanceId`) with cursor-based pagination, time range filtering, and multi-instance aggregation. The CLI now fetches logs from the gateway API in local mode (falling back to direct file reading when the gateway isn't running), and the web UI uses cursor polling instead of SSE.

## 0.11.11

### Patch Changes

- [`bfe56d7`](https://github.com/Action-Llama/action-llama/commit/bfe56d7e9a7d57b513c1694d1e63aa2ec68e06e9) Thanks [@asselstine](https://github.com/asselstine)! - Added `--cloud` (`-c`) flag to `al kill`, `al pause`, and `al resume` commands.
  `kill -c` stops running cloud tasks directly via ECS/Cloud Run APIs.
  `pause -c` and `resume -c` forward to the cloud-deployed scheduler's gateway.
  Also added `runtimeId` field to `RunningAgent` to store full cloud identifiers
  needed for kill operations (ECS task ARN, Cloud Run execution path).

- [`653cd03`](https://github.com/Action-Llama/action-llama/commit/653cd034213e95cbb022a9387c47fa7840f94b18) Thanks [@asselstine](https://github.com/asselstine)! - Fixed GitHub webhook `orgs` filter being silently ignored. The `buildFilterFromTrigger` function
  now correctly passes `orgs` through to the filter. Also added `org` as a convenience shorthand
  for `orgs` (e.g., `org = "acme"` instead of `orgs = ["acme"]`), and `al doctor` now validates
  webhook trigger fields and rejects unrecognized keys with helpful suggestions.

- [`9919997`](https://github.com/Action-Llama/action-llama/commit/9919997ea39fb452673abe4673789dc90422bc32) Thanks [@asselstine](https://github.com/asselstine)! - Fixed Lambda agents failing with `Runtime.ExitError` by removing `process.exit()` calls
  from the Lambda handler. The handler was exiting before Lambda finished processing the
  invocation response, causing a race condition. The Runtime API loop now continues naturally,
  allowing Lambda to freeze the environment between invocations.

## 0.11.10

### Patch Changes

- [`2a0f2c9`](https://github.com/Action-Llama/action-llama/commit/2a0f2c96443abc1bab2776898217a2d06e258650) Thanks [@asselstine](https://github.com/asselstine)! - Remove `# syntax=public.ecr.aws/docker/dockerfile:1` directive from Dockerfile.
  The ECR public mirror doesn't carry the BuildKit frontend image, causing CodeBuild
  Docker builds to fail. BuildKit is already the default builder, so the directive
  is unnecessary.

- [`1688bef`](https://github.com/Action-Llama/action-llama/commit/1688bef79d67ea4e09892a481d4530a55b28dd9d) Thanks [@asselstine](https://github.com/asselstine)! - Stop logging the gateway API key during `al cloud deploy`. The doctor
  check-only mode (used by cloud deploy in CI) now skips the gateway API
  key section entirely instead of generating and printing the key to stdout.

## 0.11.9

### Patch Changes

- [`71bbcf5`](https://github.com/Action-Llama/action-llama/commit/71bbcf51a250d8cf5d2c095128fbede9d5c0b718) Thanks [@asselstine](https://github.com/asselstine)! - Bake git SHA into `dist/build-info.json` at build time so Docker image tags are
  consistent across npm installs. Previously, `GIT_SHA` was computed at runtime via
  `git rev-parse`, which returned the user's project SHA instead of the package's,
  busting the local Docker image cache on every commit. Also switched the Dockerfile
  syntax directive from Docker Hub to the ECR mirror to avoid rate-limit failures
  in CodeBuild.

## 0.11.8

### Patch Changes

- [`4a4f21b`](https://github.com/Action-Llama/action-llama/commit/4a4f21bd40cb34cd7e2011d91d738436eca0a773) Thanks [@asselstine](https://github.com/asselstine)! - Fixed missing `lstatSync` import in aws-shared.ts that caused a build failure.

- [`9dcda35`](https://github.com/Action-Llama/action-llama/commit/9dcda357b304fbe8b88bdd8f93838ac518c0c4c9) Thanks [@asselstine](https://github.com/asselstine)! - Fix Docker build output leaking into TUI during `al start`. Switched
  `buildImage()` from synchronous `execFileSync` with inherited stderr to async
  `spawn` with all stdio piped. BuildKit output is now parsed and forwarded
  through `onProgress` instead of printing directly to the terminal, so the
  Ink-based TUI can render cleanly during builds. Also piped stderr in the
  `image.ts` helper used by `al run`.

## 0.11.7

### Patch Changes

- [`bb77b18`](https://github.com/Action-Llama/action-llama/commit/bb77b1899bbdd92fa14adcb51927e0f8b1a21ebd) Thanks [@asselstine](https://github.com/asselstine)! - Fixed local Docker builds failing with `COPY static/ /app/static/: not found` by passing
  the build directory as an explicit absolute path to Docker instead of relying on `cwd` + `"."`.
  Also restructured `buildImage()` into three linear phases (resolve content, inject COPY,
  prepare context) to reduce nesting and branching.

- [`9eb9982`](https://github.com/Action-Llama/action-llama/commit/9eb9982bae23bf0ef28ae20c6f9e75d0cfd1c983) Thanks [@asselstine](https://github.com/asselstine)! - Fixed agent Docker builds failing with `COPY static/ /app/static/: not found`. The static/
  directory was written to a temp build context but Docker was invoked with the package root
  as its build context, so it could never find the files. Now the temp directory is used as
  Docker's build context when extra files are present.

## 0.11.6

### Patch Changes

- [`b88d2aa`](https://github.com/Action-Llama/action-llama/commit/b88d2aa2c21a47d3f3f1d9de4d7bdc1315bb3d91) Thanks [@asselstine](https://github.com/asselstine)! - Fixed agent Docker builds failing with `COPY static/ /app/static/: not found` when agents
  have no extra files. The COPY directive was hardcoded in the thin-agent Dockerfile template
  regardless of whether a static/ directory existed, and was also duplicated when extra files
  were present.

## 0.11.5

### Patch Changes

- [`a74ceba`](https://github.com/Action-Llama/action-llama/commit/a74cebacee535db3189dfd1c0f540609bc9129ec) Thanks [@asselstine](https://github.com/asselstine)! - Docker images are now tagged with git SHA (primary), semver, and latest instead of
  only `:latest`. The git SHA tag is immutable and used for builds and deployments,
  making rollbacks deterministic and debugging easier. OCI labels
  (`org.opencontainers.image.revision`, `org.opencontainers.image.version`) are baked
  into the base image so `docker inspect` shows which commit built a running container.

## 0.11.4

### Patch Changes

- [`66f1603`](https://github.com/Action-Llama/action-llama/commit/66f1603d5101c8911de49966d4fe8accbe485b39) Thanks [@asselstine](https://github.com/asselstine)! - fixed docker static copy out

## 0.11.3

### Patch Changes

- [#97](https://github.com/Action-Llama/action-llama/pull/97) [`9e460c2`](https://github.com/Action-Llama/action-llama/commit/9e460c29e38d9bc51c3fcab08485d5cc4ae996db) Thanks [@asselstine](https://github.com/asselstine)! - Added `--expose` / `-e` flag to `al start` for VPS deployment. Binds the gateway to `0.0.0.0` (public) while keeping all local-mode features enabled (web UI, control routes, filesystem credentials, SQLite state). Closes [#91](https://github.com/Action-Llama/action-llama/issues/91).

- [`c1e3b5d`](https://github.com/Action-Llama/action-llama/commit/c1e3b5dfcd1b62a2c798744d46d17c81b813bc42) Thanks [@asselstine](https://github.com/asselstine)! - Extracted core scheduling logic (executeRun, dispatchTriggers, drainQueues, runWithReruns)
  from scheduler/index.ts into a new scheduler/execution.ts module. This separates pure
  scheduling logic from startup orchestration, enabling focused unit tests without
  infrastructure mocks.

- [`a37e214`](https://github.com/Action-Llama/action-llama/commit/a37e2145ecdef3ee3dbd12fe89fdacf0d39b7899) Thanks [@asselstine](https://github.com/asselstine)! - Respect the --web-ui flag in cloud mode. Previously, cloud mode forced the web UI
  off, causing a 404 on /dashboard after login. Also added a root URL redirect to
  /dashboard when the web UI is enabled.

- [`cb3bc6c`](https://github.com/Action-Llama/action-llama/commit/cb3bc6cd51ea25886586d7a3bcfe4a343257917e) Thanks [@asselstine](https://github.com/asselstine)! - Fixed `al logs -c -f <instance-id>` producing no output. Cloud log commands now
  accept a task/instance ID (from `al stat -c`) in addition to agent names. When an
  instance ID is passed, logs are filtered to that specific task's CloudWatch stream.
  Added shared `resolveTarget()` so all commands that accept agent-or-instance resolve
  consistently.

- [#98](https://github.com/Action-Llama/action-llama/pull/98) [`36057de`](https://github.com/Action-Llama/action-llama/commit/36057de5f01abb5208733a2a4f29687ccd526a4e) Thanks [@asselstine](https://github.com/asselstine)! - Preserve webhook queues on SIGTERM and add `al stop` command. Previously, shutting down
  the scheduler (SIGINT/SIGTERM) called `clearAll()` which deleted queued events from the
  persistent StateStore, losing pending webhook events during rolling updates. Now the signal
  handler only clears in-memory state, preserving persistent queues for the next instance.
  The new `al stop` command intentionally clears both in-memory and persistent queues for a
  clean shutdown. Closes [#95](https://github.com/Action-Llama/action-llama/issues/95).

- [`5f9a15a`](https://github.com/Action-Llama/action-llama/commit/5f9a15aefaa90d5edad1f97ea447ff00d849cfec) Thanks [@asselstine](https://github.com/asselstine)! - Cleaned up scheduler plain-logger output: removed noisy agent-level events (assistant turns,
  bash commands, tool errors) from stdout. Only core scheduling events (triggers, completions,
  shutdowns, rate-limit retries) now appear. Agent details remain in file logs. When running
  agents at scale > 1, instance-level start/completion lines are now shown (e.g. `reviewer(1) started`).

- [`9a1ad6a`](https://github.com/Action-Llama/action-llama/commit/9a1ad6ac492672f8061b11b52656babd153d7bca) Thanks [@asselstine](https://github.com/asselstine)! - Unified scheduler webhook and agent-trigger queues into a single per-agent work queue.
  This simplifies the drain logic (two separate drain functions replaced by one), removes
  ~240 lines of code, and fixes a bug where webhook run completions did not drain queued
  agent-trigger items. Also fixed a latent crash in the rerun loop when `triggers` was
  undefined in the run outcome.

- [`e374031`](https://github.com/Action-Llama/action-llama/commit/e374031de16f759c189011eefcf5e37745231496) Thanks [@asselstine](https://github.com/asselstine)! - `al doctor -c` now reconciles the App Runner instance role's inline policy to match the
  current code. Previously, infrastructure-level IAM policies (like DynamoDB permissions on
  `al-apprunner-instance-role`) could only be updated by re-running the full `al cloud init`
  provisioning wizard. The scheduler policy document is now defined in a single shared
  function to prevent drift between provisioning and reconciliation.

## 0.11.2

### Patch Changes

- [`c4ac015`](https://github.com/Action-Llama/action-llama/commit/c4ac0150997f4718e9133cd322cb0103c948bf05) Thanks [@asselstine](https://github.com/asselstine)! - Updated ECS docs to use `al-*` wildcard for the ECR repository resource ARN in the
  operator IAM policy, matching the convention used by `al cloud init`.

- [#86](https://github.com/Action-Llama/action-llama/pull/86) [`149008e`](https://github.com/Action-Llama/action-llama/commit/149008e8a5d7bcb3585f6b30e72e3bd611d8311a) Thanks [@asselstine](https://github.com/asselstine)! - Fixed cloud scheduler logs command (`al logs -c`) not working due to incorrect App Runner log group naming convention. The function now dynamically discovers the correct CloudWatch log group pattern used by App Runner services and provides better error messaging when the service is not deployed or no logs are available yet.

- [`30c4384`](https://github.com/Action-Llama/action-llama/commit/30c4384e16e283d1b5b8190063fe30c3a54645fb) Thanks [@asselstine](https://github.com/asselstine)! - Added missing ECR permissions to the operator IAM policy in ecs.md. The
  `assembleImageDirect` path (used for thin agent images) requires
  `GetDownloadUrlForLayer`, `PutImage`, `InitiateLayerUpload`,
  `UploadLayerPart`, and `CompleteLayerUpload` on the deploy role.

- [`29bd471`](https://github.com/Action-Llama/action-llama/commit/29bd4712bf61ba95881477c48132a689e3ce859d) Thanks [@asselstine](https://github.com/asselstine)! - Fixed /login returning 404 when the gateway has an API key configured but the web UI
  is disabled. Login/logout routes are now registered whenever auth is active, not only
  when the full dashboard is enabled.

- [`3c97162`](https://github.com/Action-Llama/action-llama/commit/3c971623b9209c0ecd2d49e539caea3c95231d2e) Thanks [@asselstine](https://github.com/asselstine)! - Fixed critical scheduler scaling bugs where only one agent instance could run at a time
  despite scale > 1. The `isAgentRunning` runtime check blocked concurrent instances by
  finding the first instance's container and bailing; this check is removed from the hot
  path and replaced with startup-time orphan detection. The `_running` flag is now set
  synchronously to close a race window. Agent-to-agent triggers are now queued instead of
  silently dropped when all runners are busy. The `killInstance` method on RunnerPool now
  correctly finds runners by instanceId.

- [`7c1fb06`](https://github.com/Action-Llama/action-llama/commit/7c1fb060410ed6486f5c905da70f86f56d00c806) Thanks [@asselstine](https://github.com/asselstine)! - Added persistent state store for scheduler runtime state (container registry, resource locks,
  work queues, inter-agent calls). Uses SQLite locally and DynamoDB in cloud mode. This fixes
  a bug where the cloud scheduler lost track of running containers after an App Runner restart,
  causing "invalid secret" errors when agents tried to acquire resource locks. `al cloud setup`
  now automatically provisions the DynamoDB table (`al-state`) and grants the required permissions.

- [#94](https://github.com/Action-Llama/action-llama/pull/94) [`0696640`](https://github.com/Action-Llama/action-llama/commit/06966407db809c5df6f7a3e6f9f1e64f81f4db70) Thanks [@asselstine](https://github.com/asselstine)! - Added preflight steps system for declarative data staging before agent runs.
  Define `[[preflight]]` steps in `agent-config.toml` to clone repos, fetch URLs,
  or run shell commands — all inside the container after credentials load but
  before the LLM session starts. Three built-in providers: `shell`, `http`, and
  `git-clone`. Params support `${VAR}` env var interpolation. Steps marked
  `required: false` log a warning and continue on failure. Closes [#85](https://github.com/Action-Llama/action-llama/issues/85).

- [#92](https://github.com/Action-Llama/action-llama/pull/92) [`2efb712`](https://github.com/Action-Llama/action-llama/commit/2efb712b332968c1de1a5cc0ce37c59e235b7631) Thanks [@asselstine](https://github.com/asselstine)! - Unified `al stat` and `al stat -c` output to show the same structure: an agents
  summary table with trigger types (cron, webhook, or manual) and instance counts,
  plus a running instances table with per-instance trigger info. Added `al stat [agent]`
  detail view showing full config (schedule, webhook sources/filters, scale, timeout)
  and filtered instances. Closes [#83](https://github.com/Action-Llama/action-llama/issues/83).

## 0.11.1

### Patch Changes

- [#77](https://github.com/Action-Llama/action-llama/pull/77) [`7c53bd2`](https://github.com/Action-Llama/action-llama/commit/7c53bd2c450248969fbd362b7a8506a9cb0ee759) Thanks [@asselstine](https://github.com/asselstine)! - The `-w` flag now automatically enables the gateway, eliminating the need to specify both `-g` and `-w` flags. Users can now simply use `al start -w` to enable the web dashboard. Closes [#76](https://github.com/Action-Llama/action-llama/issues/76).

- [#81](https://github.com/Action-Llama/action-llama/pull/81) [`ee6c600`](https://github.com/Action-Llama/action-llama/commit/ee6c60087c0d404eb2a6dbdea5c7af7b280779a9) Thanks [@asselstine](https://github.com/asselstine)! - Renamed CLI commands for better consistency. The cloud setup and teardown commands
  have been restructured from `al cloud setup`/`al cloud teardown` to
  `al setup cloud`/`al teardown cloud`. This change provides a more logical command
  hierarchy and better aligns with potential future setup/teardown operations for
  other infrastructure types. Closes [#80](https://github.com/Action-Llama/action-llama/issues/80).

## 0.11.0

### Minor Changes

- [`e94e1d4`](https://github.com/Action-Llama/action-llama/commit/e94e1d43e941399619b97089e691472706380f4d) Thanks [@asselstine](https://github.com/asselstine)! - Replaced `AL_DASHBOARD_SECRET` Basic Auth with a single API key for both CLI and browser access. The key is stored at `~/.action-llama/credentials/gateway_api_key/default/key` and generated automatically by `al doctor` or on first `al start`. Browser sessions use a login page that sets an HttpOnly cookie; CLI commands send a Bearer token. Added dashboard controls: per-agent Run and Enable/Disable buttons, scheduler Pause/Resume, and Logout. Added `al kill`, `al pause`, `al resume` to CLI docs. A deprecation warning is logged if `AL_DASHBOARD_SECRET` is still set.

### Patch Changes

- [`3982b79`](https://github.com/Action-Llama/action-llama/commit/3982b7947927cb5a837bb5d0bf35b40323372ae0) Thanks [@asselstine](https://github.com/asselstine)! - Added agent-scoped interactive mode to `al chat`. Running `al chat <agent>` loads the
  agent's credentials as environment variables (GITHUB_TOKEN, GIT_SSH_COMMAND, etc.) and
  opens an interactive session in the agent's directory. Use `-c` to load credentials from
  the cloud secrets manager instead of the local filesystem. The agent's ACTIONS.md is
  provided as reference context but is not auto-executed. A warning is shown if the gateway
  is not reachable, since resource locks, agent calls, and signals require a running gateway.

- [`686922e`](https://github.com/Action-Llama/action-llama/commit/686922ef1d15faec9a3b76d652a975182cc42280) Thanks [@asselstine](https://github.com/asselstine)! - Refactored cloud infrastructure behind a `CloudProvider` interface. AWS (ECS) and GCP (Cloud Run)
  logic is now organized under `src/cloud/aws/` and `src/cloud/gcp/` respectively, with provider-specific
  provisioning, teardown, IAM, and deploy modules. CLI commands are thin wrappers that delegate to the
  provider. Added state file persistence for tracking provisioned resources. Split `CloudConfig` into a
  discriminated union (`EcsCloudConfig | CloudRunCloudConfig`) with per-provider validation. Moved
  credential directory to `~/.action-llama/credentials/`.

- [`af51124`](https://github.com/Action-Llama/action-llama/commit/af51124339a724c80f5e56b6d2ac33d5ec3018c7) Thanks [@asselstine](https://github.com/asselstine)! - Added per-agent pause, resume, and kill commands. Use `al agent pause <name>` to stop
  scheduling new runs for a specific agent, `al agent resume <name>` to re-enable it, and
  `al agent kill <name>` to terminate all running instances of an agent. The gateway also
  exposes these as `POST /control/agents/:name/pause`, `/resume`, and `/kill` endpoints.
  `al status` now shows `(PAUSED)` next to disabled agents. The container runner's `abort()`
  method now properly kills the running Docker container instead of being a no-op.

- [#73](https://github.com/Action-Llama/action-llama/pull/73) [`0fec527`](https://github.com/Action-Llama/action-llama/commit/0fec527316cd470bdb20351af55bb6b95e482321) Thanks [@asselstine](https://github.com/asselstine)! - Optimized `al logs` command performance for faster log reading. Improved local log file reading with reverse-read algorithm that turns O(file) operations into O(N), direct filename computation to skip directory scans for common cases, and file watching instead of polling for follow mode. Enhanced dashboard log streaming with async file operations and fs.watch() instead of 500ms polling. Optimized CloudWatch log queries with time-bounded searches starting from narrow windows. These changes provide significant performance improvements, especially for large log files. Closes [#72](https://github.com/Action-Llama/action-llama/issues/72).

- [`f701b75`](https://github.com/Action-Llama/action-llama/commit/f701b7503349311986778a5486aed498016bdffa) Thanks [@asselstine](https://github.com/asselstine)! - Added project-level Dockerfile for customizing the shared base image. `al new` now
  scaffolds a `Dockerfile` at the project root that extends `al-agent:latest`. Users can
  add system packages, environment variables, or CLI tools that all agents in the project
  share. When the project Dockerfile has customizations beyond the bare `FROM`, the build
  pipeline creates an intermediate `al-project-base:latest` image; when unmodified, the
  extra build step is skipped entirely with zero overhead.

- [`fc5ef7f`](https://github.com/Action-Llama/action-llama/commit/fc5ef7f598a92ac305547623a43fe8c154954282) Thanks [@asselstine](https://github.com/asselstine)! - Simplified CLI commands: renamed `al status` to `al stat`, merged per-agent
  `al agent pause/resume/kill` into `al pause [name]`, `al resume [name]`, and
  `al kill <target>` (tries agent name first, falls back to instance ID). The
  `al agent` subcommand group has been removed.

- [#71](https://github.com/Action-Llama/action-llama/pull/71) [`505f264`](https://github.com/Action-Llama/action-llama/commit/505f2646b117d1e964c446c87f1a5f51a0bcc456) Thanks [@asselstine](https://github.com/asselstine)! - Added OpenTelemetry integration with support for trace instrumentation and AWS X-Ray integration. Configure telemetry in `config.toml` with `[telemetry]` section to enable observability for scheduler operations, agent executions, webhook processing, and HTTP gateway requests. Supports local OpenTelemetry collectors and AWS X-Ray via ADOT sidecars on ECS deployments. Telemetry is disabled by default to avoid unexpected network traffic. Closes [#69](https://github.com/Action-Llama/action-llama/issues/69).

- [`5eda7ba`](https://github.com/Action-Llama/action-llama/commit/5eda7bafd9628d948033039315ef637869011ae5) Thanks [@asselstine](https://github.com/asselstine)! - Optimize cloud deploy image builds with multiple caching strategies: CodeBuild local
  Docker layer cache, stable cache tags with `--cache-from`, direct ECR image assembly
  for thin agents (bypasses CodeBuild entirely), batched CodeBuild jobs for heavy agents,
  and a multi-stage scheduler Dockerfile that caches npm install separately from code changes.

## 0.10.2

### Patch Changes

- [`49a680a`](https://github.com/Action-Llama/action-llama/commit/49a680afe54c74a354c52c854f5675a4eeb1f1af) Thanks [@asselstine](https://github.com/asselstine)! - Refactored codebase for improved maintainability and testability. Added typed error
  classes (ConfigError, CredentialError, CloudProviderError, AgentError) with a unified
  CLI error handler (withCommand). Extracted shared HMAC webhook validation, split
  oversized modules (doctor.ts, cloud-setup.ts, scheduler/index.ts) into focused files,
  and added test helper factories. Removed dead code from scheduler directory. No
  user-facing behavior changes.

- [`87514b7`](https://github.com/Action-Llama/action-llama/commit/87514b71e867a695c1f568ee23b2b5285d40b3f4) Thanks [@asselstine](https://github.com/asselstine)! - Harden gateway security: bind to localhost by default (cloud mode uses 0.0.0.0),
  disable control routes/dashboard/lock-status endpoints in cloud mode since they
  are local-only concerns, scope `/locks/list` to the requesting agent's own locks,
  add 10 MB webhook body size limit, add per-IP rate limiting (120 req/min) on
  webhook endpoints, validate agent names against `[a-z0-9-]` pattern, fix path
  traversal in dashboard log access, replace `execSync` with `execFileSync` in
  git helper to prevent shell injection, and warn when dashboard runs without
  `AL_DASHBOARD_SECRET`.

## 0.10.1

### Patch Changes

- [`002f069`](https://github.com/Action-Llama/action-llama/commit/002f069851557879b66aea037869856b700ebd25) Thanks [@asselstine](https://github.com/asselstine)! - Reduced Lambda cold start time through multiple optimizations: bake shell scripts
  into the Docker image instead of writing them at container startup, switch to Alpine
  base image (~100-150MB smaller), parallelize AWS Secrets Manager lookups, cache Lambda
  function image URIs to skip redundant update/wait API calls on repeated launches, split
  container entry into init/invocation phases so Lambda can reuse model and config across
  warm starts, convert credential builtins to a static import, and add `--omit=optional`
  to the container npm install.

- [`94aed13`](https://github.com/Action-Llama/action-llama/commit/94aed13b2025713f15bc9495e18dc9f25f5018cb) Thanks [@asselstine](https://github.com/asselstine)! - Make the agent argument optional in `al logs`, defaulting to scheduler logs.
  Running `al logs` or `al logs -c` without an agent name now shows scheduler logs
  instead of erroring with "missing required argument".

## 0.10.0

### Minor Changes

- [`c10d85d`](https://github.com/Action-Llama/action-llama/commit/c10d85d6180a6076e1559bc31fb4da424dee81a5) Thanks [@asselstine](https://github.com/asselstine)! - Replace fire-and-forget `[TRIGGER]` mechanism with agent-to-agent calls that return values. Agents can now use `al-call`, `al-check`, and `al-wait` shell commands to invoke other agents, continue working, and retrieve structured results via `[RETURN]...[/RETURN]` blocks. Calls are queued in a unified per-agent work queue (shared with webhook events) when all runners are busy, with a configurable `workQueueSize` (default: 100). New config fields: `maxCallDepth` (replaces `maxTriggerDepth`, default: 3), `workQueueSize` (replaces `webhookQueueSize`, default: 100). Old field names still work as fallbacks.

- [#59](https://github.com/Action-Llama/action-llama/pull/59) [`a69e985`](https://github.com/Action-Llama/action-llama/commit/a69e985188b36f3c0259b45103388d3c9a915788) Thanks [@asselstine](https://github.com/asselstine)! - Remove `--no-docker` option and enforce container isolation. Docker container isolation is now mandatory for all agent execution to strengthen the product's security model. The `--no-docker` flag and `local.enabled = false` configuration option have been removed. Closes [#53](https://github.com/Action-Llama/action-llama/issues/53).

- [#56](https://github.com/Action-Llama/action-llama/pull/56) [`587ae39`](https://github.com/Action-Llama/action-llama/commit/587ae3971b319801e634641e45ef6d2ef3bacb84) Thanks [@asselstine](https://github.com/asselstine)! - Migrated signal system from text-pattern markers to file-based shell commands. Agents now use `al-rerun`, `al-status "<text>"`, `al-return`, and `al-exit [code]` commands instead of `[RERUN]`, `[STATUS: text]`, `[RETURN]...[/RETURN]`, and `[EXIT: code]` text patterns. The old `[TRIGGER: agent]...[/TRIGGER]` pattern was already superseded by `al-call`. Commands write signal files to `$AL_SIGNAL_DIR` and optionally POST to the gateway for real-time TUI updates. This is more robust than text scanning and aligns with the existing command pattern used by `rlock`, `al-call`, and `al-shutdown`. Closes [#51](https://github.com/Action-Llama/action-llama/issues/51).

### Patch Changes

- [#64](https://github.com/Action-Llama/action-llama/pull/64) [`00c6d40`](https://github.com/Action-Llama/action-llama/commit/00c6d402e16480b0ea38d0ac19df662d20e6b366) Thanks [@asselstine](https://github.com/asselstine)! - Added agent instance management and scheduler control commands. The new functionality includes:

  - `al status` now shows running agent instances with unique IDs and scheduler pause state
  - `al kill <instance-id>` allows killing a specific running agent instance
  - `al pause` pauses the scheduler to prevent new runs from starting
  - `al resume` resumes the scheduler after being paused

  All management commands require the gateway to be running (start scheduler with `-g` flag). Instance IDs are generated with the format `{agentName}-{timestamp}-{randomHex}` and are displayed in the status output. Closes [#62](https://github.com/Action-Llama/action-llama/issues/62).

- [`eaa50b7`](https://github.com/Action-Llama/action-llama/commit/eaa50b7f356f02906afd0384b113a00873ce5b6f) Thanks [@asselstine](https://github.com/asselstine)! - Fixed several inconsistencies introduced during recent refactorings:

  - Wired control routes (`pause`, `resume`, `kill`) into the gateway so CLI commands work at runtime
  - Removed stale `--no-docker` references from error messages (flag was removed in [#59](https://github.com/Action-Llama/action-llama/issues/59))
  - Config now reads `maxCallDepth` and `workQueueSize` with fallback to deprecated field names
  - Replaced `any` types with proper `StatusTracker` imports in status-reporter, execution-engine, and runtime-factory
  - Removed dead `trigger-parser.ts` (duplicate of logic in runner.ts, never imported)
  - Updated AGENTS.md skills reference to reflect current signal/command names

- [#61](https://github.com/Action-Llama/action-llama/pull/61) [`2283d1f`](https://github.com/Action-Llama/action-llama/commit/2283d1f0bb8f18330a90734c43ac1bbe57a1bbb2) Thanks [@asselstine](https://github.com/asselstine)! - Added support for resource locks when running the scheduler and agent containers locally. The system now automatically creates a gateway proxy container that enables containers to communicate with the host's gateway service across all platforms (Linux, Mac, Windows). This fixes resource locking functionality for local Docker deployments. Closes [#57](https://github.com/Action-Llama/action-llama/issues/57).

- [#65](https://github.com/Action-Llama/action-llama/pull/65) [`26a32d9`](https://github.com/Action-Llama/action-llama/commit/26a32d9191240baf84522aee5032ed52196a4cd4) Thanks [@asselstine](https://github.com/asselstine)! - Unified credential handling by migrating all code to use async backend-aware API, eliminating sync filesystem-specific functions. All credential operations (`loadCredentialField`, `writeCredentialField`, `credentialExists`, etc.) are now consistently async and work with both local filesystem and remote backends. This change improves consistency and reduces API surface area, preventing accidental divergence between sync and async credential handling patterns. Closes [#55](https://github.com/Action-Llama/action-llama/issues/55).

## 0.9.2

### Patch Changes

- [`ed94aef`](https://github.com/Action-Llama/action-llama/commit/ed94aef70419d434b55c69e1ab78a5fb8260d2af) Thanks [@asselstine](https://github.com/asselstine)! - Fixed `al logs -f -c` for AWS Lambda and ECS. Follow mode previously required a
  running task to be detected via `listRunningAgents`, which always returned empty
  for Lambda and missed short-lived ECS tasks. Now polls CloudWatch directly by
  agent name, so follow works regardless of whether a task is currently running.

## 0.9.1

### Patch Changes

- [`2468a0e`](https://github.com/Action-Llama/action-llama/commit/2468a0eaa0c0283c67ab98196d42959085bce0e6) Thanks [@asselstine](https://github.com/asselstine)! - Fix cloud deploy: create AWS service-linked roles for ECS and App Runner during
  `al cloud setup`, include base agent Dockerfile in scheduler image so the
  scheduler can verify image caches at runtime, and fix build context to use copies
  instead of symlinks for cross-filesystem compatibility.

## 0.9.0

### Minor Changes

- [`9c20121`](https://github.com/Action-Llama/action-llama/commit/9c20121340db6b57a66b0231e2b9f7816b21fed4) Thanks [@asselstine](https://github.com/asselstine)! - Added `al cloud deploy` to deploy the scheduler itself to the cloud as a long-running service.
  For AWS/ECS projects, the scheduler runs on App Runner; for GCP/Cloud Run projects, it runs
  as a Cloud Run service. The scheduler image is built with all project config and agent
  definitions baked in, and the entrypoint runs `al start -c --headless --gateway`.

  New config fields `cloud.schedulerCpu` and `cloud.schedulerMemory` control instance sizing
  (defaults: 0.25 vCPU / 512 MB for App Runner, 1 vCPU / 512 Mi for Cloud Run).
  AWS deployments also accept `cloud.appRunnerInstanceRoleArn` and `cloud.appRunnerAccessRoleArn`.

  `al cloud teardown` now tears down the scheduler service in addition to per-agent IAM resources.
  `al status -c` shows scheduler service status (URL, state, creation time).
  `al logs scheduler -c` tails the cloud scheduler's logs.

  The scheduler reads `GATEWAY_URL` env var to resolve its own webhook endpoint URL when
  running in the cloud, avoiding the chicken-and-egg problem with service URLs.

## 0.8.2

### Patch Changes

- [`a38fb0a`](https://github.com/Action-Llama/action-llama/commit/a38fb0abab640e70f52bc5e26e797f5af23d1e5f) Thanks [@asselstine](https://github.com/asselstine)! - Fix Lambda agents failing with "Request must be smaller than 5120 bytes" on
  UpdateFunctionConfiguration. Secrets are now passed in the invoke payload
  (256 KB limit) instead of as environment variables (4 KB limit), which also
  ensures each agent can only see its own configured credentials.

## 0.8.1

### Patch Changes

- [`63e47f0`](https://github.com/Action-Llama/action-llama/commit/63e47f005706af2c9b15f74b62755d883567e2cf) Thanks [@asselstine](https://github.com/asselstine)! - Fixed `al logs -c` for ECS agents failing with "Cannot order by LastEventTime with a logStreamNamePrefix" by replacing the DescribeLogStreams-based tail with FilterLogEvents. Cloud logs now render through the same conversation/raw formatter as local logs, and Lambda platform lines (START, END, REPORT) are filtered out. Added `--instance` flag to `al logs` for agents with `scale > 1` — in follow mode, lists running instances and lets you pick one; in local mode, targets a specific instance's log file. Fixed local Docker `fetchLogs` to aggregate logs across all containers for the same agent.

## 0.8.0

### Minor Changes

- [#50](https://github.com/Action-Llama/action-llama/pull/50) [`c65a240`](https://github.com/Action-Llama/action-llama/commit/c65a240219f8b03383b9eb5a7a344cbb69794d52) Thanks [@asselstine](https://github.com/asselstine)! - Add Linear credentials and webhooks integration

  This adds comprehensive Linear support to Action Llama:

  **New credential types:**

  - `linear_token` - Personal API token authentication
  - `linear_oauth` - OAuth2 authentication (client ID, secret, access/refresh tokens)
  - `linear_webhook_secret` - Webhook signature validation secret

  **New webhook provider:**

  - `linear` webhook type for receiving Linear organization-level webhooks
  - Support for issues and comment events with filtering by organization, labels, assignee, and author
  - HMAC signature validation using Linear webhook secrets

  **Features:**

  - OAuth2 as the default authentication method with personal token fallback
  - Organization-level webhook configuration
  - Comprehensive filtering for Linear issues and comment events
  - Full test coverage for both credential validation and webhook handling
  - Complete documentation with setup guides and examples

  This enables agents to authenticate with Linear workspaces and respond to Linear webhook events like issue creation, updates, and comments.

### Patch Changes

- [`7106a26`](https://github.com/Action-Llama/action-llama/commit/7106a26bb73b097df0adfa8049e2e157856b2a94) Thanks [@asselstine](https://github.com/asselstine)! - `al logs` now defaults to a colorful conversation view that shows assistant text,
  bash commands, tool usage, and errors in a readable format. Pass `-r`/`--raw` to
  see the original JSON structured logs. Agent text output is now logged per-turn
  so it appears in the conversation view.

- [`b3f189d`](https://github.com/Action-Llama/action-llama/commit/b3f189dc3ec6bef92c14bc8c1daa4f08210e982c) Thanks [@asselstine](https://github.com/asselstine)! - Renamed `al console` command to `al chat`. The command behavior is unchanged.

- [`0aed2bf`](https://github.com/Action-Llama/action-llama/commit/0aed2bfd05926b8dc725b1136ffe34fa057c2af6) Thanks [@asselstine](https://github.com/asselstine)! - Renamed `PLAYBOOK.md` to `ACTIONS.md` as the agent system prompt file. All references
  in source code, docs, and examples updated. Existing agents will need to rename
  their `PLAYBOOK.md` files to `ACTIONS.md`.

## 0.7.2

### Patch Changes

- [`6f2fb9c`](https://github.com/Action-Llama/action-llama/commit/6f2fb9ce43dfdb4f420eca7ebdd208d38c3d9af4) Thanks [@asselstine](https://github.com/asselstine)! - Make the gateway opt-in via `al start -g` instead of starting automatically.
  The `--web-ui` flag now requires `-g`. Webhooks also require the gateway;
  a warning is logged if agents have webhook triggers but `-g` was not passed.

  Agents now use `rlock`, `runlock`, `rlock-heartbeat`, and `al-shutdown` shell
  commands instead of raw curl. These are written to `/tmp/bin/` at container
  startup and gracefully no-op when `GATEWAY_URL` is not set, allowing scale=1
  cloud agents to run with a local scheduler without a gateway.

  Removed the credential-fetch and log-forwarding gateway routes that are no
  longer used (credentials are always injected via volume mounts or env vars).

## 0.7.1

### Patch Changes

- [`3866e9f`](https://github.com/Action-Llama/action-llama/commit/3866e9fddfc2504b2627caabf71e82b19a4cc0a4) Thanks [@asselstine](https://github.com/asselstine)! - Fixed Lambda agents starting repeatedly on failure. AWS Lambda's async invocation
  auto-retries (default 2) caused duplicate container starts that the scheduler didn't
  control. Now sets `MaximumRetryAttempts: 0` on each Lambda function. Also fixed stale
  CloudWatch log replay by filtering `streamLogs` and `waitForExit` to only read logs
  from the current invocation's launch time.

- [`8490d91`](https://github.com/Action-Llama/action-llama/commit/8490d91076f77f3bd1246f1f508d312cd3c93268) Thanks [@asselstine](https://github.com/asselstine)! - Fixed Lambda container images timing out during init phase. The container entry
  point now implements the Lambda Runtime API protocol via a dedicated handler
  (`lambda-handler.ts`), keeping the init phase lightweight. The Lambda function's
  ENTRYPOINT is overridden via `ImageConfig` so Docker/ECS containers are unaffected.

## 0.7.0

### Minor Changes

- [`1c90d37`](https://github.com/Action-Llama/action-llama/commit/1c90d37683fcbe5154d10e622d88690452e13e53) Thanks [@asselstine](https://github.com/asselstine)! - Replace `[SILENT]` signal with `[RERUN]` to make reruns opt-in instead of opt-out.
  Previously, any run that completed without `[SILENT]` was treated as productive work
  and triggered reruns — meaning errors, rate limits, and empty responses caused unwanted
  reruns. Now the safe default is no rerun; agents must explicitly emit `[RERUN]` to
  request an immediate rerun for backlog draining. Added a top-level Signals section to
  AGENTS.md so new projects document `[RERUN]`, `[STATUS]`, and `[TRIGGER]` prominently.

## 0.6.10

### Patch Changes

- [`4092724`](https://github.com/Action-Llama/action-llama/commit/4092724cfec7e4dab1e77092fee01f1c84f9ee24) Thanks [@asselstine](https://github.com/asselstine)! - Show base image build progress as a single top-level TUI status line instead of
  duplicating it under every agent. Previously, each agent row showed identical
  "Base image: ..." status text during the shared base image build.

- [`d6d1f0e`](https://github.com/Action-Llama/action-llama/commit/d6d1f0e457200c0736a24650a7ede09049f33617) Thanks [@asselstine](https://github.com/asselstine)! - Fixed `al logs -c` returning the oldest log entries instead of the newest.
  CloudWatch's FilterLogEvents API returns events oldest-first, so `al logs -c`
  was showing stale logs. Now uses GetLogEvents with `startFromHead: false` on
  the most recent log streams for true tail behavior. Also fixed Lambda's
  follow mode (`-f`) to track position with nextToken instead of re-fetching
  the same events every poll cycle.

- [`1e8000b`](https://github.com/Action-Llama/action-llama/commit/1e8000b6c39988b6a1584cc76fdeb9765e5ce40f) Thanks [@asselstine](https://github.com/asselstine)! - Fix Lambda agents re-running endlessly when there's no work to do. The `[SILENT]`
  marker was missed due to a race between CloudWatch log polling and exit detection,
  causing every run to be treated as "completed" (did work) instead of "silent" (no work).
  Lambda's `waitForExit` now scans for `[SILENT]` in the same logs it reads for the
  REPORT line, and returns exit code 42 which the container runner treats as silent.

- [`87861ea`](https://github.com/Action-Llama/action-llama/commit/87861eacb626a734afdec7c539c53220acb272e8) Thanks [@asselstine](https://github.com/asselstine)! - Headless mode (`al start`) now shows why each agent is running. Log lines include
  the trigger reason: `schedule`, `webhook`, `triggered by <agent>`, or `schedule (rerun N/M)`.

- [`363fee9`](https://github.com/Action-Llama/action-llama/commit/363fee9c9517141a643120642703a412257a1524) Thanks [@asselstine](https://github.com/asselstine)! - Log base image build progress in headless mode. Previously there was no output
  between "scheduler started" and the first agent build, which could be several
  minutes of silence when the base image needed to be built or cached.

## 0.6.9

### Patch Changes

- [`b7671e1`](https://github.com/Action-Llama/action-llama/commit/b7671e13156214eaf003956afa8bcef88ee3fb31) Thanks [@asselstine](https://github.com/asselstine)! - Set `HOME=/tmp` in container entry so that child processes (like the agent harness)
  that write to `$HOME` (e.g. `git config --global`) work on Lambda's read-only filesystem.

## 0.6.8

### Patch Changes

- [`b5429b9`](https://github.com/Action-Llama/action-llama/commit/b5429b9b9ce8a6ba14ceecc9ca2a30bb0ad2e850) Thanks [@asselstine](https://github.com/asselstine)! - Bake agent config, PLAYBOOK.md, and prompt skeleton into Docker images at build time instead of passing them as Lambda environment variables at runtime. This fixes AWS Lambda's 4KB environment variable size limit being exceeded when agents have large playbooks or configurations. The container entry point reads from baked-in files at `/app/static/` and falls back to environment variables for backwards compatibility with older images.

- [`b7b8f7d`](https://github.com/Action-Llama/action-llama/commit/b7b8f7d588e64501e1fe68ecdb290afe47b7fc90) Thanks [@asselstine](https://github.com/asselstine)! - Standardized `/tmp` as the only writable directory across all platforms. Agents now
  receive an `<environment>` block in their prompt documenting the read-only root
  filesystem and `/tmp` as the working directory. The container entry point uses `/tmp`
  instead of the previous `/workspace` directory, and the local Docker runtime mounts
  a single 2GB tmpfs at `/tmp`. SSH keys are now written to `/tmp/.ssh` instead of
  `$HOME/.ssh`, fixing a failure on Lambda where `/home/node` is read-only. This ensures
  consistent behavior across local Docker, ECS Fargate, Lambda, and Cloud Run.

- [`6dc20d9`](https://github.com/Action-Llama/action-llama/commit/6dc20d96e694b4e8bd1d9be901236b4933b7511e) Thanks [@asselstine](https://github.com/asselstine)! - Fixed base image build appearing three times in logs during cloud deploys. The build
  was only running once but progress was broadcast to every agent, producing duplicate
  log lines. Base image progress is now shown on all agents with a "Base image: " prefix
  so it's clear it is a single shared build. Also fixed a race condition where parallel
  per-agent image builds could corrupt each other by writing to a shared `static/`
  directory — each build now uses an isolated temp directory.

- [`c8dbb56`](https://github.com/Action-Llama/action-llama/commit/c8dbb56128fbfd12b426452bfeba3b2f05d894a9) Thanks [@asselstine](https://github.com/asselstine)! - Deny gateway credential fetch (403) for containers whose credentials were injected
  via environment variables. Previously returned 404; now explicitly rejects the request
  to reduce the credential-fetch surface for ECS/Lambda containers.

- [`3a1c000`](https://github.com/Action-Llama/action-llama/commit/3a1c000da8cd2129216fc67e09b4b143bb744aac) Thanks [@asselstine](https://github.com/asselstine)! - Added `ecr:SetRepositoryPolicy` to the operator IAM policy in the ECS docs.
  This permission is required by `al doctor -c` to grant Lambda image pull access
  on the ECR repository.

- [`fb0d249`](https://github.com/Action-Llama/action-llama/commit/fb0d24934abdacce80bc123b4832f5e36ef0d0f6) Thanks [@asselstine](https://github.com/asselstine)! - Fixed `al logs -c` failing for Lambda-backed agents with a validation error about empty `logStreamNamePrefix`. The empty string is now omitted from the CloudWatch API call.

- [`e5664e2`](https://github.com/Action-Llama/action-llama/commit/e5664e2257baa622c283bd2d3488120788b760d1) Thanks [@asselstine](https://github.com/asselstine)! - Fixed Lambda memory limit error by lowering the default from 4096 MB to 512 MB
  and clamping to Lambda's 3008 MB maximum. Previously, the uncapped 4096 MB default
  caused `MemorySize value failed to satisfy constraint` errors on every Lambda invocation.

- [`25de91c`](https://github.com/Action-Llama/action-llama/commit/25de91c6ce864ef9cb385d726c839549e9780390) Thanks [@asselstine](https://github.com/asselstine)! - Fixed container entry crashing on Lambda due to hardcoded `/home/node/.ssh` path
  and read-only `~/.gitconfig`. The SSH directory now uses `$HOME` (falling back to
  `/tmp`), and git credential helper uses `GIT_CONFIG_COUNT` env vars instead of
  `git config --global`, avoiding filesystem writes in read-only containers.

- [`449d052`](https://github.com/Action-Llama/action-llama/commit/449d052beacec25b85578c21c9ae72788f48eea2) Thanks [@asselstine](https://github.com/asselstine)! - `al cloud setup` now grants `iam:PassRole` on `al-*` roles and `iam:PutUserPolicy`
  (self) to the calling IAM user during initial setup. `al doctor -c` also attempts
  to update PassRole grants when roles change. Fixes "not authorized to perform
  iam:PassRole" errors when launching Lambda agents.

- [`7f8c521`](https://github.com/Action-Llama/action-llama/commit/7f8c521cbda340cc0852a0a0909dfff0b71627c3) Thanks [@asselstine](https://github.com/asselstine)! - Fixed Lambda failing to pull ECR images by setting an ECR repository policy
  granting `lambda.amazonaws.com` pull access. Unlike ECS (which uses IAM role
  permissions), Lambda requires an explicit resource policy on the ECR repository.
  The policy is now applied during `al cloud init` and `al doctor -c`.

- [`f08c1f9`](https://github.com/Action-Llama/action-llama/commit/f08c1f98e49cc0d74490394cd9f9562bd7a74539) Thanks [@asselstine](https://github.com/asselstine)! - Grant CloudWatch Logs read permissions to the operator IAM user during `al cloud setup`.
  Previously, `al logs` would fail with an authorization error because the setup wizard
  only granted `iam:PassRole`. The new `ActionLlamaOperator` inline policy includes
  `logs:FilterLogEvents` and `logs:GetLogEvents` on both ECS and Lambda log groups.

- [`a237139`](https://github.com/Action-Llama/action-llama/commit/a237139ecc703e12121a8d5870951c3fd5e8fe13) Thanks [@asselstine](https://github.com/asselstine)! - Fixed CodeBuild image cache hash instability caused by temp Dockerfile filenames
  containing random UUIDs. The hash now uses a stable "Dockerfile" key instead of
  the temp filename, so identical build contexts produce cache hits as expected.

- [`cecb696`](https://github.com/Action-Llama/action-llama/commit/cecb696c751d10a2a3550ee647d8714d8ff466d2) Thanks [@asselstine](https://github.com/asselstine)! - Fix `al logs -c` returning empty results for Lambda-routed agents. The logs command
  now uses the same runtime selection logic as the scheduler, routing to LambdaRuntime
  (and its CloudWatch log group) for agents with timeout <= 900s.

## 0.6.7

### Patch Changes

- [`ae26389`](https://github.com/Action-Llama/action-llama/commit/ae263899e57b2be9f8bc006a60715f2d360c67d2) Thanks [@asselstine](https://github.com/asselstine)! - Fixed Lambda and ECS environment variable key validation errors when credential
  instance names contain hyphens or other special characters. Keys like
  `AL_SECRET_github__my-org__token` are now encoded to comply with AWS's
  `[a-zA-Z][a-zA-Z0-9_]+` constraint.

## 0.6.6

### Patch Changes

- [`f80da66`](https://github.com/Action-Llama/action-llama/commit/f80da6664d5fa99ce50a4bbc2a16500af76ecc08) Thanks [@asselstine](https://github.com/asselstine)! - Fixed resource locking across all execution modes. Cloud containers (ECS/Cloud Run)
  now register with the gateway for lock coordination — previously all lock requests
  from cloud containers returned 403. Lock holders are now instance-specific (e.g.
  "my-agent-1", "my-agent-2") so agents with scale > 1 can each hold their own lock
  instead of conflicting on a shared agent name. Added startup warnings when cloud mode
  is missing `gateway.url` and when `scale > 1` is used without Docker.

- [`02fe95f`](https://github.com/Action-Llama/action-llama/commit/02fe95ff534382bbba708e991a8f4bf5a40e0eb7) Thanks [@asselstine](https://github.com/asselstine)! - Added per-agent timeout support and automatic AWS Lambda routing. Agents can now set
  `timeout` in `agent-config.toml` (falls back to global `[local].timeout`, then 900s).
  For the ECS cloud provider, agents with timeout <= 900s automatically route to Lambda
  for faster cold starts and lower cost, while longer-running agents stay on ECS Fargate.
  New config fields: `lambdaRoleArn`, `lambdaSubnets`, `lambdaSecurityGroups` in `[cloud]`.
  `al doctor -c` now creates Lambda execution roles for short-timeout agents.

## 0.6.5

### Patch Changes

- [`b4eaeb9`](https://github.com/Action-Llama/action-llama/commit/b4eaeb91b8249edbf364f5ef9558e9f43e914fcd) Thanks [@asselstine](https://github.com/asselstine)! - Allow `scale = 0` in agent-config.toml to disable an agent. Disabled agents skip
  credential validation, Docker image builds, cron jobs, and webhook bindings while
  remaining visible (as disabled) in the TUI. This lets users keep agent configs in
  the project without running them.

## 0.6.4

### Patch Changes

- [`32756b2`](https://github.com/Action-Llama/action-llama/commit/32756b2c4e0cec2bc827d2dcc32127987123d80b) Thanks [@asselstine](https://github.com/asselstine)! - Fixed cloud agents (ECS/Cloud Run) not receiving GATEWAY_URL and SHUTDOWN_SECRET
  env vars, which prevented locking and coordination. Cloud containers can now reach
  the gateway by setting `gateway.url` in config.toml to the public gateway URL.

## 0.6.3

### Patch Changes

- [`ef15a89`](https://github.com/Action-Llama/action-llama/commit/ef15a89b0e27a06c6f8f39d160a49e07e237a87b) Thanks [@asselstine](https://github.com/asselstine)! - Improved local Docker build caching. Added `.dockerignore` to exclude `node_modules`,
  `.git`, `src/`, `test/`, and other non-build files from the build context. Enabled
  BuildKit explicitly and added an npm cache mount so `npm install` layers are reused
  even when `package.json` changes.

- [`9911cb8`](https://github.com/Action-Llama/action-llama/commit/9911cb84ab22aabf9523749ea869ee835c983d76) Thanks [@asselstine](https://github.com/asselstine)! - Show clickable cloud console links in the TUI dashboard for running agents. When the
  scheduler runs in Cloud Run or ECS mode, each agent row displays a direct URL to the
  execution or task in the GCP/AWS console for full log inspection.

## 0.6.2

### Patch Changes

- [`532ec69`](https://github.com/Action-Llama/action-llama/commit/532ec698edaef0964f53e1a38dfdf6beb3fd3083) Thanks [@asselstine](https://github.com/asselstine)! - TUI and web dashboard now display agent scale and running instance count. Agents with
  `scale > 1` show "Running 2/3" when active and "Idle (×3)" when idle, giving visibility
  into how many parallel runners are busy. Scale-1 agents display as before.

- [`1d53297`](https://github.com/Action-Llama/action-llama/commit/1d532970a9779290062350a6e4f38d865976bc3f) Thanks [@asselstine](https://github.com/asselstine)! - New projects created with `al new` now include a `CLAUDE.md` symlink alongside `AGENTS.md`,
  both pointing to the shipped AGENTS.md in node_modules. This allows Claude Code (which looks
  for CLAUDE.md) to automatically pick up agent instructions without extra setup.

## 0.6.1

### Patch Changes

- [`8f597f9`](https://github.com/Action-Llama/action-llama/commit/8f597f94282987620fce637de1fab6367069d59c) Thanks [@asselstine](https://github.com/asselstine)! - Added LLM-audience skills documentation at `skills/` covering credentials, signals, resource locks, and environment context. These ship with the published package so agents can reference them. AGENTS.md now links to the skills directory.

## 0.6.0

### Minor Changes

- [`104a802`](https://github.com/Action-Llama/action-llama/commit/104a80270cce0e313119fd916cd32fb25d0f5d72) Thanks [@asselstine](https://github.com/asselstine)! - Added configurable parallelism for agents. Set `parallelism = N` in agent-config.toml to run multiple instances of the same agent concurrently. Allows dev agents to tackle issues in parallel and reviewers to handle multiple PRs simultaneously. Defaults to 1 for backward compatibility. Closes [#39](https://github.com/Action-Llama/action-llama/issues/39).

### Patch Changes

- [#44](https://github.com/Action-Llama/action-llama/pull/44) [`a91d1d5`](https://github.com/Action-Llama/action-llama/commit/a91d1d58b5cf609885a9519af56d844e346fa231) Thanks [@asselstine](https://github.com/asselstine)! - Added ability to stop and start agents in the TUI. Use ↑/↓ arrow keys to select agents and
  Space to enable/disable them. Disabled agents skip scheduled runs and ignore webhook events.
  The TUI shows enabled/disabled state and tracks counts in the header. Closes [#43](https://github.com/Action-Llama/action-llama/issues/43).

- [#49](https://github.com/Action-Llama/action-llama/pull/49) [`6f60c7c`](https://github.com/Action-Llama/action-llama/commit/6f60c7c106396d85d23964acfe29955d9a9d10ae) Thanks [@asselstine](https://github.com/asselstine)! - Added configurable scale for agents. Set `scale` in agent-config.toml to control concurrent runs per agent (defaults to 1). This allows dev agents to tackle multiple issues in parallel and reviewers to handle multiple PRs simultaneously. Includes full test coverage and documentation. Closes [#39](https://github.com/Action-Llama/action-llama/issues/39).

- [#36](https://github.com/Action-Llama/action-llama/pull/36) [`0f8fb18`](https://github.com/Action-Llama/action-llama/commit/0f8fb1846b9ef053a6b5a7d627f700d1f8b6cc90) Thanks [@asselstine](https://github.com/asselstine)! - Fixed second agent ECS role assumption failures with improved validation and error handling. The scheduler now validates IAM task roles exist before starting, and provides better error messages when ECS cannot assume roles. Closes [#34](https://github.com/Action-Llama/action-llama/issues/34).

- [#46](https://github.com/Action-Llama/action-llama/pull/46) [`16ded1c`](https://github.com/Action-Llama/action-llama/commit/16ded1c5434998bd30d7a9e6e1f56c7b1beb7736) Thanks [@asselstine](https://github.com/asselstine)! - Renamed `parallelism` to `scale` in agent config. Update your agent-config.toml files to use `scale` instead of `parallelism`. The functionality remains the same - it controls how many instances of an agent can run concurrently. Closes [#45](https://github.com/Action-Llama/action-llama/issues/45).

- [`2255f61`](https://github.com/Action-Llama/action-llama/commit/2255f61f1a4b9dd8cf393e9925a863ff492b4f09) Thanks [@asselstine](https://github.com/asselstine)! - Added resource locking for agents running with `scale > 1`. Agents can use LOCK/UNLOCK
  skills in their playbook to coordinate concurrent instances and prevent them from working
  on the same resource. The gateway exposes lock endpoints and accepts a configurable
  `gateway.lockTimeout` in `config.toml`.

- [`6840c9a`](https://github.com/Action-Llama/action-llama/commit/6840c9a1ac75f80ce04e5c502fd941a1d80c838a) Thanks [@asselstine](https://github.com/asselstine)! - Simplified the resource lock API from two parameters to one. `LOCK("resource", "key")` is now `LOCK("resourceKey")` — e.g. `LOCK("github issue acme/app#42")`. The same change applies to `UNLOCK()` and `HEARTBEAT()`. The HTTP endpoints now accept a single `resourceKey` field instead of separate `resource` and `key` fields.

- [#38](https://github.com/Action-Llama/action-llama/pull/38) [`19ad85b`](https://github.com/Action-Llama/action-llama/commit/19ad85b913705c03e78602ca68f850d8510af505) Thanks [@asselstine](https://github.com/asselstine)! - Fixed gateway startup timing to show build status instead of 502 errors. When running `al start -c -H -w` (cloud mode with headless and web UI), the gateway now starts before Docker images are built, allowing users to see build progress on the dashboard instead of getting 502 errors. Closes [#37](https://github.com/Action-Llama/action-llama/issues/37).

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
