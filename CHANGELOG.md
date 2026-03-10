# @action-llama/action-llama

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
