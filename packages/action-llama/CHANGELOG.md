# @action-llama/action-llama

## 0.23.0

### Minor Changes

- [#452](https://github.com/Action-Llama/action-llama/pull/452) [`f796147`](https://github.com/Action-Llama/action-llama/commit/f796147ccebe6bd1e242b0b6f5ba99575eab0e17) Thanks [@asselstine](https://github.com/asselstine)! - Add agent admin page with gear icon link from agent detail. Moves Scale, Enable/Disable, and Skill content to a combined admin page. Replaces Run/Chat buttons with a RunDropdown split-button component.

### Patch Changes

- [#448](https://github.com/Action-Llama/action-llama/pull/448) [`5f04184`](https://github.com/Action-Llama/action-llama/commit/5f04184c3dd5476b70803153726add3bf9f6d588) Thanks [@asselstine](https://github.com/asselstine)! - Remove dead code in execution/routes/locks.ts — the invalid URI scheme branch was unreachable since `new URL()` already rejects URIs with invalid schemes (e.g. `123://...`) by throwing, which is caught by the existing catch block.

- [`48e1f14`](https://github.com/Action-Llama/action-llama/commit/48e1f140882445e812129cca7acf6d0991d1c3cb) Thanks [@asselstine](https://github.com/asselstine)! - Throttle SSE status stream (max 2/sec) and debounce invalidation-driven refetches (1s) to prevent 429 errors from rapid-fire updates during active agent runs.

- [#453](https://github.com/Action-Llama/action-llama/pull/453) [`b176a4d`](https://github.com/Action-Llama/action-llama/commit/b176a4d5ad20357be33f0de7409312a9752af5e0) Thanks [@asselstine](https://github.com/asselstine)! - Add compact trigger badges to the agent dashboard. Each agent row now shows small, colored labels under the agent name indicating its configured triggers (e.g. "schedule", "github issues created"). Labels are computed from agent config and streamed via SSE. Closes [#441](https://github.com/Action-Llama/action-llama/issues/441).

## 0.22.0

### Minor Changes

- [#439](https://github.com/Action-Llama/action-llama/pull/439) [`df637a5`](https://github.com/Action-Llama/action-llama/commit/df637a5dce3e04167ce2db6421dc770cd3af3567) Thanks [@asselstine](https://github.com/asselstine)! - Add Google Cloud Run Jobs as a first-class agent execution runtime.

  Agents can now run as ephemeral Cloud Run Jobs while the scheduler continues to run on a local machine or VPS. Key features:

  - **`CloudRunRuntime`** — implements `Runtime` and `ContainerRuntime`, launching agents as Cloud Run Jobs
  - **Secret Manager credentials** — each credential field is staged as an ephemeral Secret Manager secret, mounted at `/credentials/<type>/<instance>/<field>` (identical layout to Docker volume mounts)
  - **Artifact Registry** — agent images are pushed to Google Artifact Registry with automatic pruning of old tags (keeps 3 most recent)
  - **Cloud Logging** — agent logs are streamed via Cloud Logging API (3s polling)
  - **Orphan recovery** — `listRunningAgents()` discovers active Cloud Run Jobs; orphaned jobs are killed on scheduler restart
  - **`gcp_service_account` credential** — new built-in credential type for GCP service account JSON keys
  - **`CloudRunConfig` config type** — new `[cloud] provider = "cloud-run"` environment file config
  - **`cloudRunDockerExtension`** — registers the new runtime as an extension
  - **Docs** — new guide at `guides/cloud-run-runtime.mdx` and reference updates

### Patch Changes

- [#435](https://github.com/Action-Llama/action-llama/pull/435) [`2701ed9`](https://github.com/Action-Llama/action-llama/commit/2701ed9f9e3d369b57e7ccbaea7d372fa2441229) Thanks [@asselstine](https://github.com/asselstine)! - Fix EACCES errors in host-user-runtime tests when /tmp/al-runs is root-owned.

  The source code now reads `AL_RUNS_DIR` from the environment (falling back to the existing `/tmp/al-runs` default), and the test suite creates an isolated temp directory per test run and points `AL_RUNS_DIR` at it via `process.env`. This prevents permission errors when `/tmp/al-runs` already exists and is owned by root.

- [#436](https://github.com/Action-Llama/action-llama/pull/436) [`fe33d47`](https://github.com/Action-Llama/action-llama/commit/fe33d47f163d8e694efc4f1bac8ddf85363bb5a6) Thanks [@asselstine](https://github.com/asselstine)! - Replace jq dependency in al-subagent and al-subagent-wait scripts with shell string concatenation, fixing test failures in environments without jq installed

## 0.21.0

### Minor Changes

- [#426](https://github.com/Action-Llama/action-llama/pull/426) [`af9e0fb`](https://github.com/Action-Llama/action-llama/commit/af9e0fbe77afee8195bc6574b32e2530310d5853) Thanks [@asselstine](https://github.com/asselstine)! - Add `groups` field to `AgentRuntimeType` for host-user runtime Docker socket access

  The `[runtime]` table in `agents/<name>/config.toml` now accepts a `groups` array
  that specifies additional OS groups the agent process should run with. When set, the
  host-user runtime passes `-g <group>` to `sudo` so the agent gains access to resources
  protected by that group (e.g. the Docker socket requires the `docker` group).

  Example `config.toml` for an agent that needs Docker access:

  ```toml
  [runtime]
  type = "host-user"
  groups = ["docker"]
  ```

  The `al doctor` command now also validates that any explicitly-configured groups exist
  on the system, warning if a configured group is not found.

  This fixes the e2e-coverage-improver agent's inability to run `npm run test:e2e` due
  to the Docker socket being inaccessible when running as `al-agent` without docker group
  membership.

### Patch Changes

- [#428](https://github.com/Action-Llama/action-llama/pull/428) [`819390c`](https://github.com/Action-Llama/action-llama/commit/819390c091fcec7f17415a599523b4ad4fbfe7d9) Thanks [@asselstine](https://github.com/asselstine)! - Add missing `groups = ["docker"]` to e2e-coverage-improver agent config

  The `e2e-coverage-improver` agent's `config.toml` was missing the `groups = ["docker"]`
  field that was introduced in PR [#426](https://github.com/Action-Llama/action-llama/issues/426). Without it, the agent runs without Docker group
  membership and cannot connect to `/var/run/docker.sock`, causing all e2e test runs to
  fail with `EACCES /var/run/docker.sock`. Closes [#427](https://github.com/Action-Llama/action-llama/issues/427).

- [#434](https://github.com/Action-Llama/action-llama/pull/434) [`8b22a34`](https://github.com/Action-Llama/action-llama/commit/8b22a34e255842543933f03d231fdb2348dcfaa8) Thanks [@asselstine](https://github.com/asselstine)! - Fix e2e-coverage-improver config.toml to include complete configuration

  PR [#428](https://github.com/Action-Llama/action-llama/issues/428) created the config.toml with only the `[runtime]` section, missing the
  `models`, `credentials`, `schedule`, `timeout`, and `[params]` fields required
  for the agent to run correctly. This restores the full configuration including
  `groups = ["docker"]` so the agent has Docker socket access.

- [#430](https://github.com/Action-Llama/action-llama/pull/430) [`38d36b1`](https://github.com/Action-Llama/action-llama/commit/38d36b19c5c5975ec064b882312c305cfa6f6d0a) Thanks [@asselstine](https://github.com/asselstine)! - Fix hot-reload not updating HostUserRuntime when agent runtime config changes

  When an agent's `config.toml` is modified at runtime (e.g. adding `groups = ["docker"]` to the `[runtime]` section), the hot-reload watcher now correctly:

  1. Creates a new `HostUserRuntime` with the updated configuration (runAs user and groups)
  2. Updates `agentRuntimeOverrides` so future agent launches use the new runtime
  3. Calls `setRuntime` on all existing runners in the pool so even in-flight or next-queued runs pick up the change

  Previously, the watcher updated the `AgentConfig` but left the old `HostUserRuntime` instance (without the docker group) in place, causing Docker socket access failures for agents that gained `groups = ["docker"]` via a live config edit.

- [#419](https://github.com/Action-Llama/action-llama/pull/419) [`070a6e1`](https://github.com/Action-Llama/action-llama/commit/070a6e166b757178d104f657c2d67167d5d4bcbf) Thanks [@asselstine](https://github.com/asselstine)! - Fix HostUserRuntime orphan reattachment after scheduler restart. Previously,
  adopted orphan processes failed immediately because waitForExit and streamLogs
  had no handle to the process spawned by the previous scheduler. Now stdio is
  directed to the log file (not pipes) so child processes survive restarts, and
  reattach() reconstructs in-memory state from PID files. All methods (streamLogs,
  waitForExit, kill) follow a single code path for both fresh and adopted processes.

- [#423](https://github.com/Action-Llama/action-llama/pull/423) [`b2b8d95`](https://github.com/Action-Llama/action-llama/commit/b2b8d9554057f8f178d726aaf12bfb04faa2e54c) Thanks [@asselstine](https://github.com/asselstine)! - Merge the Triggers and Jobs pages into a unified Activity page. The new Activity page shows pending queue items, running instances, completed jobs, errors, and dead letters all in one view, sorted by timestamp. A Status filter replaces the dead-letters checkbox, and all existing /triggers and /jobs URLs redirect to /activity. Agent detail pages link to /activity?agent=X.

  Also adds a `peek()` method to the WorkQueue interface (MemoryWorkQueue, SqliteWorkQueue, EventSourcedWorkQueue) to expose queued items without consuming them, enabling pending items to appear as rows in the Activity feed.

## 0.20.0

### Minor Changes

- [#417](https://github.com/Action-Llama/action-llama/pull/417) [`8060033`](https://github.com/Action-Llama/action-llama/commit/806003383a04d05d37b526b3a8bad11079c66c16) Thanks [@asselstine](https://github.com/asselstine)! - Extract webhook queueing / dispatch policy into `dispatchOrQueue()` in `src/execution/dispatch-policy.ts`. Centralizes the "check paused → check pool → check runner → queue or execute" decision that was previously duplicated across five call sites (webhook handler, cron handler, triggerAgent, call-dispatcher, dispatchTriggers). Pure refactoring — no behavior changes.

### Patch Changes

- [`2518841`](https://github.com/Action-Llama/action-llama/commit/2518841e90078e80090a7d498cba870ead12643a) Thanks [@asselstine](https://github.com/asselstine)! - Add orphan recovery for HostUserRuntime (no-Docker mode). Previously, if the
  scheduler crashed or restarted while a HostUserRuntime agent was running, the
  orphaned process was invisible to the new scheduler — leading to zombie agents,
  duplicate runs, and leaked resources. Now HostUserRuntime writes PID files
  alongside each running process, enabling `listRunningAgents()` and
  `inspectContainer()` to discover and re-adopt orphans on restart, matching the
  resilience of Docker-based runtimes. The scheduler shutdown handler also
  terminates tracked child processes on graceful exit.

- [`f13edb5`](https://github.com/Action-Llama/action-llama/commit/f13edb5d7082e54e415f1a442874ae5760324d3e) Thanks [@asselstine](https://github.com/asselstine)! - Move integration tests from action-llama package into the e2e package so that
  `npm test` runs only fast unit tests. Integration tests are now available via
  `npm run test:integration` which delegates to the e2e workspace. Added
  `./internals/*` subpath exports to expose internal modules needed by the
  integration harness.

## 0.19.2

### Patch Changes

- [`25ea33a`](https://github.com/Action-Llama/action-llama/commit/25ea33ac48e32ee9366fe161b5f45e5db63c2d8d) Thanks [@asselstine](https://github.com/asselstine)! - Fix MaxListenersExceededWarning during `al start` by raising the process event listener limit. The scheduler, TUI, gateway, and telemetry collectively register more than Node's default 10 cleanup handlers per signal.

## 0.19.1

### Patch Changes

- [`d2245f2`](https://github.com/Action-Llama/action-llama/commit/d2245f215acf9cf9b85340d3ed4fe553d95ef906) Thanks [@asselstine](https://github.com/asselstine)! - Fix startup crash (`Can't find meta/_journal.json`) by including the `drizzle/` migrations folder in the published npm package. Previously the folder was missing from the `files` array in `package.json`, so database migrations failed at runtime.

## 0.19.0

### Minor Changes

- [#407](https://github.com/Action-Llama/action-llama/pull/407) [`983bf7d`](https://github.com/Action-Llama/action-llama/commit/983bf7d76b1bb592271d8585fad9f8f96ea00550) Thanks [@asselstine](https://github.com/asselstine)! - Reduce duplicated orchestration between host and container runners

  - Extract shared `RunResult`, `RunOutcome`, `TriggerRequest` types into `src/agents/types.ts`
  - Create `src/agents/session-loop.ts` with shared model-fallback + session-creation + event-subscription loop
  - Refactor `container-entry.ts` and `cli/commands/run-agent.ts` to use the shared session loop
  - Extract shared container monitoring logic into `ContainerAgentRunner.monitorContainer()` private method, used by both `run()` and `adoptContainer()`
  - Remove dead code: `src/agents/runner.ts` (`AgentRunner` class) and `src/agents/execution-engine.ts` (`ExecutionEngine` class) were unused in production
  - Add tests for `session-loop.ts`

### Patch Changes

- [#412](https://github.com/Action-Llama/action-llama/pull/412) [`b49f875`](https://github.com/Action-Llama/action-llama/commit/b49f87572a9134c2401555608bd750d2602bb3fa) Thanks [@asselstine](https://github.com/asselstine)! - Refactor scheduler startup into explicit phases. Extract `dependencies.ts`, `persistence.ts`, and `orphan-recovery.ts` from `scheduler/index.ts` for independent testability. No behavior changes.

- [#409](https://github.com/Action-Llama/action-llama/pull/409) [`0103fab`](https://github.com/Action-Llama/action-llama/commit/0103fab1a884cebf25b535ba257fe957757f4640) Thanks [@asselstine](https://github.com/asselstine)! - Introduce Drizzle ORM as the data access layer for all SQLite operations. Consolidates the three separate databases (`.al/state.db`, `.al/stats.db`, `.al/work-queue.db`) into a single `.al/action-llama.db` managed by Drizzle migrations. On startup, pending migrations are applied automatically and existing data from legacy databases is migrated transparently. Existing `.db` files are backed up to `.al/backups/<timestamp>/` before migration. Closes [#398](https://github.com/Action-Llama/action-llama/issues/398).

- [#410](https://github.com/Action-Llama/action-llama/pull/410) [`7794dd8`](https://github.com/Action-Llama/action-llama/commit/7794dd80c8152f4f2d7e50ebd2036f2f5fab4907) Thanks [@asselstine](https://github.com/asselstine)! - Fix ghost runner leak and manual trigger queuing when all runners are busy.

  When `withSpan` threw before `_runInternalContainer` ran, the `ContainerAgentRunner` would be permanently stuck with `isRunning === true`, causing the runner pool to show "all busy" even though the status tracker had no record of it. The `run()` method now wraps the `withSpan` call in a try/catch and resets `_running` on failure.

  Manual triggers via the control API now queue when all runners are busy (matching webhook/schedule behavior) instead of returning an error string. This means pressing Run in the dashboard while an agent is running will queue the request and return an instanceId.

  Frontend API errors with JSON bodies (e.g. `{"error":"..."}`) now display the human-readable message instead of raw JSON.

  Closes [#404](https://github.com/Action-Llama/action-llama/issues/404)

- [`6696a90`](https://github.com/Action-Llama/action-llama/commit/6696a90f32eb2db424be1f74743b368f36e21594) Thanks [@asselstine](https://github.com/asselstine)! - Increase container PID limit from 256 to 1024 to prevent EAGAIN fork failures in agents that run heavy workloads (npm install, test suites, etc.)

- [#413](https://github.com/Action-Llama/action-llama/pull/413) [`9fe3158`](https://github.com/Action-Llama/action-llama/commit/9fe3158e080beae2cbf127159fb150d62a22e71b) Thanks [@asselstine](https://github.com/asselstine)! - Add explicit Jobs queue to the dashboard. Replaces "Recent Triggers" on agent detail pages with a "Jobs" section showing pending, running, and completed jobs. Adds a new /jobs page with agent filtering and pagination. Adds a trigger detail page at /dashboard/triggers/:instanceId with type-specific info (webhook headers/body, agent caller chain, manual prompt, schedule time). Persists trigger context (prompt for manual triggers, context for agent triggers) in the runs table for traceability. Wires up pending job counts from the work queue to the UI. Closes [#408](https://github.com/Action-Llama/action-llama/issues/408).

## 0.18.11

### Patch Changes

- [`1f8e247`](https://github.com/Action-Llama/action-llama/commit/1f8e247922985d996be9d0e31c467175fe629421) Thanks [@asselstine](https://github.com/asselstine)! - Add `--grep`, `--after`, and `--before` flags to `al logs` for filtering log output by pattern and time range. Closes [#385](https://github.com/Action-Llama/action-llama/issues/385).

- [`90c13a1`](https://github.com/Action-Llama/action-llama/commit/90c13a144df036338cd09858cfc672fc1b1d562e) Thanks [@asselstine](https://github.com/asselstine)! - Increase default agent timeout from 900s (15 min) to 3600s (1 hour). Centralize the default in a single `DEFAULT_AGENT_TIMEOUT` constant.

- [`1f8e247`](https://github.com/Action-Llama/action-llama/commit/1f8e247922985d996be9d0e31c467175fe629421) Thanks [@asselstine](https://github.com/asselstine)! - Persist scheduler state so running agent jobs survive scheduler restarts. On startup, the scheduler now re-adopts containers that are still running instead of killing them, and the SQLite-backed work queue is no longer cleared on shutdown. Closes [#388](https://github.com/Action-Llama/action-llama/issues/388).

- [`1f8e247`](https://github.com/Action-Llama/action-llama/commit/1f8e247922985d996be9d0e31c467175fe629421) Thanks [@asselstine](https://github.com/asselstine)! - Fix webhooks and manual triggers being dropped during the initial Docker image build phase. Incoming triggers are now queued and processed once the build completes. Closes [#391](https://github.com/Action-Llama/action-llama/issues/391).

- [`ab4c5d5`](https://github.com/Action-Llama/action-llama/commit/ab4c5d532d5f0d546f5e99626fa5aac16e406a6b) Thanks [@asselstine](https://github.com/asselstine)! - Move `setenv` bash function from an inline TypeScript string to a proper shell script (`al-bash-init.sh`). The function now handles multiple name/value pairs (`setenv A 1 B 2`) and tolerates stray `setenv` tokens between pairs — a common LLM mistake that previously wasted several tool calls per run.

- [`1f8e247`](https://github.com/Action-Llama/action-llama/commit/1f8e247922985d996be9d0e31c467175fe629421) Thanks [@asselstine](https://github.com/asselstine)! - Add `/triggers` SPA fallback route to the gateway so direct navigation to the triggers page works correctly. Closes [#392](https://github.com/Action-Llama/action-llama/issues/392).

## 0.18.10

### Patch Changes

- [`ebfb4e5`](https://github.com/Action-Llama/action-llama/commit/ebfb4e5f2d57dd53c8710a354eb053ba56560f3f) Thanks [@asselstine](https://github.com/asselstine)! - Move changeset check before npm install/build/test in the release workflow so the workflow exits early when there are no changesets, avoiding unnecessary CI time.

## 0.18.9

### Patch Changes

- [`830c50f`](https://github.com/Action-Llama/action-llama/commit/830c50f4de34abad98e38b245fccf79fefc16d11) Thanks [@asselstine](https://github.com/asselstine)! - `al push` now fails with a clear error when required credentials are missing locally, instead of silently creating empty placeholder directories on the remote server. Implicit credentials like `gateway_api_key` (which are auto-generated on the server) are exempt from this check. Run `al doctor` to set up missing credentials before pushing.

- [`2861796`](https://github.com/Action-Llama/action-llama/commit/2861796c76e013c2d8781b1c3d7ad81b36a082b9) Thanks [@asselstine](https://github.com/asselstine)! - Fix host-user runtime environment so agents can connect to the gateway and find tools. Gateway URL now uses `localhost` instead of Docker-internal `gateway` hostname, bin scripts (`rlock`, `al-status`, etc.) are added to PATH, and the agent prompt correctly describes a writable filesystem with CWD instead of Docker-specific `/app/static` and read-only assumptions. Credential context references `$AL_CREDENTIALS_PATH` instead of the Docker volume mount at `/credentials/`.

- [`3a1757e`](https://github.com/Action-Llama/action-llama/commit/3a1757ee77bdb044cf7fccb47dfa269d9308a124) Thanks [@asselstine](https://github.com/asselstine)! - Remove redundant `--creds-only`, `--files-only`, and `--all` flags from `al push`. The `--skip-creds` flag is sufficient since push only syncs two things (files and credentials) and there's no real use case for syncing only credentials without files.

## 0.18.8

### Patch Changes

- [`36092c1`](https://github.com/Action-Llama/action-llama/commit/36092c1504404467830dd11628e9833fdaaf41a1) Thanks [@asselstine](https://github.com/asselstine)! - `al doctor` now checks whether host-user runtime agents' system user is in the `docker` group. It warns if the user is missing from the group and, on Linux, attempts to fix it automatically with `sudo usermod -aG docker <user>`.

- [#381](https://github.com/Action-Llama/action-llama/pull/381) [`f68eb80`](https://github.com/Action-Llama/action-llama/commit/f68eb80c7c216485271d41226e47c14ca61d2d1a) Thanks [@asselstine](https://github.com/asselstine)! - Fix missing assistant text in `host-user` runtime logs. Output emitted between `launch()` and `streamLogs()` was silently dropped because `pipe()` put the stream into flowing mode immediately. Lines are now buffered from process start and replayed when `streamLogs()` attaches. Closes [#380](https://github.com/Action-Llama/action-llama/issues/380).

- [`e4f4e8c`](https://github.com/Action-Llama/action-llama/commit/e4f4e8ccb5f4c117845f90d9ae17b4fa6f405ab1) Thanks [@asselstine](https://github.com/asselstine)! - Remove repository dispatch to Action-Llama/agents from the release workflow. The agents deploy trigger is no longer needed.

## 0.18.7

### Patch Changes

- [`6ac0a92`](https://github.com/Action-Llama/action-llama/commit/6ac0a92f21e4edeafaa6a5140832a8e6114b3cf0) Thanks [@asselstine](https://github.com/asselstine)! - Trigger release publish.

## 0.18.6

### Patch Changes

- [`ccfc317`](https://github.com/Action-Llama/action-llama/commit/ccfc317ff27d49422f8f309ea1c1093adde4dd04) Thanks [@asselstine](https://github.com/asselstine)! - Add host-user runtime mode for agents that need to run on the host machine instead of inside Docker containers. Configure per-agent with `[runtime] type = "host-user"` in agent config.toml. Agents run under a separate OS user via `sudo -u` for lightweight credential isolation. Includes `al doctor` validation for user/sudoers setup, credential staging to temp directories, and working directory isolation per run.

- [`852cc3a`](https://github.com/Action-Llama/action-llama/commit/852cc3ab7f3dbe486f7cd4038ccc4608b606e4fe) Thanks [@asselstine](https://github.com/asselstine)! - Split `x_twitter_user` credential into `x_twitter_user_oauth1` (OAuth 1.0a access tokens) and `x_twitter_user_oauth2` (OAuth 2.0 PKCE credentials with client ID, client secret, access token, and refresh token). The `al doctor` OAuth 2.0 flow runs an interactive PKCE authorization via a local callback server on port 3829.

  Twitter Account Activity API subscription management now uses OAuth 2.0 user tokens per the API reference, with automatic token refresh on 401. Webhook listing continues to use app-only Bearer token.

## 0.18.5

### Patch Changes

- [#362](https://github.com/Action-Llama/action-llama/pull/362) [`7d59124`](https://github.com/Action-Llama/action-llama/commit/7d59124b2c298f9413761a68e522dce61cd3e058) Thanks [@asselstine](https://github.com/asselstine)! - Add Slack webhook provider and credential support. Agents can now listen for Slack Events API webhooks and interact with Slack via the `SLACK_BOT_TOKEN` environment variable. Includes `slack_bot_token` and `slack_signing_secret` credential types, full signature verification with replay protection, and URL verification challenge handling.

- [#363](https://github.com/Action-Llama/action-llama/pull/363) [`8c1d8b2`](https://github.com/Action-Llama/action-llama/commit/8c1d8b20dc811825c6792fdd8b0641ccf95be0c6) Thanks [@asselstine](https://github.com/asselstine)! - Show specific dead letter reason (e.g. "No Match", "Validation Failed", "Parse Error") in the trigger history UI instead of the generic "Dead Letter" label. Closes [#360](https://github.com/Action-Llama/action-llama/issues/360).

- [#367](https://github.com/Action-Llama/action-llama/pull/367) [`9e2a6e7`](https://github.com/Action-Llama/action-llama/commit/9e2a6e75cf7fc9bf1d1e7b765c670992414c1cb2) Thanks [@asselstine](https://github.com/asselstine)! - Add Discord as a webhook provider. Supports the Discord Interactions Endpoint (slash commands, message components, modals, autocomplete) with Ed25519 signature verification. Includes a new `discord_bot` credential type (`application_id`, `public_key`, `bot_token`) and filter fields for `guilds`, `channels`, `commands`, and `events`. Closes [#359](https://github.com/Action-Llama/action-llama/issues/359).

## 0.18.4

### Patch Changes

- [`5a8e3c6`](https://github.com/Action-Llama/action-llama/commit/5a8e3c63266188cbeac9d94638633e3b71613e97) Thanks [@asselstine](https://github.com/asselstine)! - Rename `al add --skill` flag to `--agent`/`-a` to match the agents/ directory convention, and copy Dockerfiles alongside SKILL.md during `al add` and `al update`. When a source repo includes a Dockerfile co-located with the SKILL.md, it is now copied into the agent directory and kept in sync on updates.

- [`6e3dd88`](https://github.com/Action-Llama/action-llama/commit/6e3dd8892a8ac01e162ca5dbd6b328115139c80a) Thanks [@asselstine](https://github.com/asselstine)! - Rewrite `al config` to use raw config instead of resolved config, preventing crashes when an agent references an undefined model. The config TUI now shows a checklist with status indicators (✓/✗/-) for each field, letting users see and fix validation issues interactively instead of hitting a fatal error.

- [`330ec89`](https://github.com/Action-Llama/action-llama/commit/330ec892b196c573bc6f6e2d4dec15e79bbff9b9) Thanks [@asselstine](https://github.com/asselstine)! - `al doctor` now collects all validation errors and displays them together instead of failing on the first problem. Uses raw runtime config to avoid crashing on undefined model references, letting it report all issues at once.

- [`6f57ba9`](https://github.com/Action-Llama/action-llama/commit/6f57ba9e44a3fd92b0436faed084e0512611fde0) Thanks [@asselstine](https://github.com/asselstine)! - Stop scaffolding a project-level Dockerfile in `al new`. Agent-level Dockerfiles
  are now the recommended approach since they keep agents self-contained and portable
  across projects. Project Dockerfiles are still supported but discouraged in docs.

- [`411e519`](https://github.com/Action-Llama/action-llama/commit/411e519f7aafcfe97515929ad238f459a850ef64) Thanks [@asselstine](https://github.com/asselstine)! - Namespace VPS server names by environment to prevent naming collisions when provisioning multiple environments on the same provider account. Servers are now named `action-llama-<envName>` instead of the hardcoded `action-llama`. Environment names are validated at creation time (lowercase alphanumeric + hyphens, max 50 chars). On teardown, shared provider firewalls are automatically deleted when no other action-llama servers reference them.

## 0.18.3

### Patch Changes

- [`ceea8d7`](https://github.com/Action-Llama/action-llama/commit/ceea8d77be0775a550ca6dd2b2095a77a6a8e596) Thanks [@asselstine](https://github.com/asselstine)! - Fix `al add` and `al update` to discover SKILL.md files in `agents/` subdirectories, not just `skills/`. Repos that organize skills under `agents/*/SKILL.md` (e.g., `Action-Llama/agents`) now work correctly.

- [`c4deb29`](https://github.com/Action-Llama/action-llama/commit/c4deb29b7fa55f99788f878068cb022a90f7d71f) Thanks [@asselstine](https://github.com/asselstine)! - Fix `--no-creds` flag on `al push` which was silently ignored due to three bugs:
  Commander's `--no-` prefix handling mapped the flag to `opts.creds = false` instead of
  `opts.noCreds = true`, the credential sync logic didn't consult the flag at all, and
  the doctor webhook security check ran before the `skipCredentials` guard. Renamed the
  CLI flag to `--skip-creds` to avoid Commander's negation semantics, gated `syncCreds`
  on `!opts.noCreds`, and moved the webhook secret check inside the `skipCredentials`
  block.

- [`0d68ac3`](https://github.com/Action-Llama/action-llama/commit/0d68ac309dfc856289381191db6e2c57d207bce5) Thanks [@asselstine](https://github.com/asselstine)! - Darken docs light mode accent color from bright yellow (#ffe970) to readable gold (#c49000) for better contrast on white backgrounds.

- [`da33730`](https://github.com/Action-Llama/action-llama/commit/da33730c13ba65c51277187123f409809bd71f17) Thanks [@asselstine](https://github.com/asselstine)! - Unify trigger history across the dashboard and agent detail page. The agent page's "Instance History" is replaced with "Recent Triggers" (5 most recent, paginated, with "View all" linking to a full agent-filtered trigger history page). Agent names now show their assigned color in all trigger tables. The `/api/stats/triggers` endpoint accepts an optional `?agent=<name>` filter.

## 0.18.2

### Patch Changes

- [#341](https://github.com/Action-Llama/action-llama/pull/341) [`575b51a`](https://github.com/Action-Llama/action-llama/commit/575b51a76ca2eafe6304f0620c53db665d46602e) Thanks [@asselstine](https://github.com/asselstine)! - Fix agent runners showing wrong running count in the Web UI dashboard.

  When a project-wide `scale` cap throttled individual agent pools, the status tracker still showed the original uncapped scale — causing displays like "3/4" when all runners were active. The tracker is now synced with actual pool sizes after runner pool creation.

  Additionally, hot-reload scale changes now use `updateAgentScale` instead of re-registering the agent (which reset the running count to zero), and the "idle" state is no longer set unconditionally at the end of a hot reload when runners are still active. The `startRun` running-count clamp at `scale` has also been removed so the count reflects reality during scale transitions. Closes [#331](https://github.com/Action-Llama/action-llama/issues/331).

- [#354](https://github.com/Action-Llama/action-llama/pull/354) [`5db4648`](https://github.com/Action-Llama/action-llama/commit/5db4648c2c675571ead8f27bfbabd0e8568eeb04) Thanks [@asselstine](https://github.com/asselstine)! - Fix iOS Safari auto-zoom when RunModal opens on mobile and make modal full-screen on small screens.

  iOS Safari zooms the viewport when a focused `<input>` or `<textarea>` has `font-size < 16px`. The RunModal auto-focuses its textarea on mount, immediately triggering the zoom. A global CSS rule now enforces `font-size: 16px` for all form controls on screens under 768px, preventing this across the entire app (RunModal, LoginPage, ChatPage, DashboardPage). The RunModal card is also made full-screen on mobile for a cleaner experience, while preserving the centered card layout on larger screens. Closes [#350](https://github.com/Action-Llama/action-llama/issues/350).

## 0.18.1

### Patch Changes

- [`db855bf`](https://github.com/Action-Llama/action-llama/commit/db855bff4091aff745b2511c51a71be8cc7a0a06) Thanks [@asselstine](https://github.com/asselstine)! - Generate unique pastel colors for each agent based on a hash of the agent
  name. Colors are consistent across the usage bar, legend, agent table, and
  agent detail page header, making it easy to visually identify agents.
  Supports both light and dark mode.

- [`f889aec`](https://github.com/Action-Llama/action-llama/commit/f889aec8b3df558caa2647465a208af2e7945677) Thanks [@asselstine](https://github.com/asselstine)! - Update all documentation to reflect the per-agent config.toml system. SKILL.md now contains only portable metadata (name, description, license, compatibility) and instructions, while runtime configuration (credentials, models, schedule, webhooks, hooks, params, scale, timeout) lives in `agents/<name>/config.toml`. Also documents the new `al add`, `al config`, and `al update` commands, and removes the obsolete `[agents.<name>]` override pattern from project config docs.

- [`d20ac23`](https://github.com/Action-Llama/action-llama/commit/d20ac239644c80af234fe64782845a2a8191ffee) Thanks [@asselstine](https://github.com/asselstine)! - Fix chat not connecting to agent container. The gateway starts before
  Docker images are built, so the chat container launcher was never wired
  up — clicking Chat or running `al chat <agent> --env` silently did
  nothing. The launcher is now connected after image builds complete via
  a late-binding `setChatRuntime` callback.

- [`4b1721a`](https://github.com/Action-Llama/action-llama/commit/4b1721abe1c1b1abe2f9a1829ed0bac4f6cd5751) Thanks [@asselstine](https://github.com/asselstine)! - Fix dark mode toggle in web dashboard. Tailwind CSS v4 defaults to
  `prefers-color-scheme` media queries, so the class-based `.dark` toggle
  had no effect. Added `@custom-variant dark` directive to enable
  class-based dark mode.

- [`cd738a6`](https://github.com/Action-Llama/action-llama/commit/cd738a65ca4954bf4b0ffd6d23134560f06412be) Thanks [@asselstine](https://github.com/asselstine)! - Fixed scheduler pause not blocking webhook triggers. When the scheduler was paused
  via `al pause`, webhooks could still trigger agent runs and queue work. Now all
  trigger paths (webhooks, agent-to-agent calls, manual triggers, and queue draining)
  respect the paused state and reject new work. Closes [#162](https://github.com/Action-Llama/action-llama/issues/162).

- [`20f75fb`](https://github.com/Action-Llama/action-llama/commit/20f75fbe9f5a3b0ea394dfd0a6170f0c685a7dbb) Thanks [@asselstine](https://github.com/asselstine)! - Fix overlapping columns in the dashboard Recent Triggers table. The `table-fixed` layout caused columns with `w-[1%]` to collapse to near-zero width, making headers and data visually overlap.

- [`6409a87`](https://github.com/Action-Llama/action-llama/commit/6409a875d785e9143b9e4ca626c290a36f3e5c57) Thanks [@asselstine](https://github.com/asselstine)! - Move agent runtime config (credentials, models, schedule, webhooks, hooks, params, scale, timeout) from SKILL.md YAML frontmatter to per-agent `config.toml` files. SKILL.md now contains only portable metadata (name, description, license, compatibility), making skills shareable across projects. Add `al add <repo>` to install skills from git repositories and `al update [agent]` to pull upstream SKILL.md changes. Add top-level `al config <name>` as a shortcut for interactive agent configuration.

- [`d9d2349`](https://github.com/Action-Llama/action-llama/commit/d9d2349c89970f4dff2358952b166292ec8a16a2) Thanks [@asselstine](https://github.com/asselstine)! - Fix SSE streaming through Cloudflare proxies by adding `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` headers to the status stream endpoint. Add per-agent invalidation signals so dashboard pages automatically re-fetch data (triggers, runs, stats, config) when mutations occur, instead of only updating on initial page load.

- [`60a00cf`](https://github.com/Action-Llama/action-llama/commit/60a00cfb64f105030ad5e8e5c9922f04837f4914) Thanks [@asselstine](https://github.com/asselstine)! - Reorganize Dockerfile docs: merge "Project Dockerfile" and "Agent Dockerfile" reference pages into a single "Dockerfiles" reference, and extract guide content into a new "Custom Dockerfiles" guide.

- [`1db35f5`](https://github.com/Action-Llama/action-llama/commit/1db35f5a84559ac026176c7b8887eb81c26f839b) Thanks [@asselstine](https://github.com/asselstine)! - Add `setenv` documentation to the agent commands reference page as a new "Environment Commands" section, with usage examples showing cross-invocation variable persistence. Update runtime context docs to cross-reference the new section.

## 0.18.0

### Minor Changes

- [`11e070f`](https://github.com/Action-Llama/action-llama/commit/11e070fb5149f16d0b1805b04984a4e3baf9ddb5) Thanks [@asselstine](https://github.com/asselstine)! - Add bidirectional real-time chat with agents via WebSocket. Users can now chat with agents through the web dashboard (`/chat/:agent`) or remotely via `al chat <agent> --env <name>`. The implementation includes a ChatTransport abstraction (local and remote), a gateway WebSocket bridge that relays messages between browsers and agent containers, a new chat container entrypoint (`AL_CHAT_MODE=1`), session management with configurable limits (`gateway.maxChatSessions`), idle timeout cleanup (15min), and rate limiting. Adds 107 tests across 8 test files covering the full chat stack.

### Patch Changes

- [`cdaf2c8`](https://github.com/Action-Llama/action-llama/commit/cdaf2c810973ad1c8b33534d8071545b59198621) Thanks [@asselstine](https://github.com/asselstine)! - Redesign dashboard layout: recent triggers now display full-width above the agents table (showing last 5 with a new Source column), agents table gains a Description column, searchable filtering, and CSS-based name truncation instead of hard character limits.

- [`b959c2a`](https://github.com/Action-Llama/action-llama/commit/b959c2a0b8aa04e9e8ee2ad81b752affd466c2e3) Thanks [@asselstine](https://github.com/asselstine)! - Streamline the web dashboard: move Config to the navbar as "Settings" with a gear icon, replace the "Connected" label with a subtle status dot in the navbar, remove the pause button and "Dashboard" header so token usage is the first thing on the page. All dashboard pages now share a single EventSource connection via React context.

- [`f710d05`](https://github.com/Action-Llama/action-llama/commit/f710d05fe7d0cbcbdd701a0aa4e25a852bf133a3) Thanks [@asselstine](https://github.com/asselstine)! - Fix sentry webhook extension metadata to reference `sentry_client_secret` instead of
  the non-existent `sentry_webhook_secret` credential type. The runtime already used the
  correct type; only the extension metadata was inconsistent.

  Also fix documentation inconsistencies: add missing `al stats` and `al webhook replay`
  command references, document all `[telemetry]` fields, document `[agents.<name>]`
  per-agent overrides, document `historyRetentionDays`, document the `/dashboard/triggers`
  page and trigger history API, fix `al logs` signature to show agent as optional, add
  `--strict` flag to `al doctor`, and remove stale `--no-docker` reference.

- [`34d6b48`](https://github.com/Action-Llama/action-llama/commit/34d6b48d83156d82794a680e23d808392b990458) Thanks [@asselstine](https://github.com/asselstine)! - Add a "Runtime Context" page to the docs concepts section explaining the full prompt structure agents receive at runtime, including agent config, credential context, environment, trigger context, and skills.

- [`2ae2fba`](https://github.com/Action-Llama/action-llama/commit/2ae2fba56ebf4f583d14a1012d5272905774bae3) Thanks [@asselstine](https://github.com/asselstine)! - Add `setenv NAME value` shell function for persisting environment variables across bash commands. Agents can now use `setenv REPO "owner/repo"` instead of manually writing to `/tmp/env.sh`. The function handles special characters safely via `printf %q` and is available in all execution modes (container, chat, local).

- [`e36936b`](https://github.com/Action-Llama/action-llama/commit/e36936ba5b54dae2abef559a3da0ea62e529e762) Thanks [@asselstine](https://github.com/asselstine)! - Add optional prompt to `al run` for directed one-shot agent runs. Users can now pass a specific task when triggering an agent manually via `al run <agent> "review PR [#42](https://github.com/Action-Llama/action-llama/issues/42)"`, through the control API (`POST /control/trigger/:name` with `{ prompt }` body), or via the web dashboard's new Run modal. When no prompt is given, behavior is unchanged. Also fixes manual triggers to use the correct manual prompt suffix instead of the scheduled prompt.

- [`899a102`](https://github.com/Action-Llama/action-llama/commit/899a1021a1b95c44b882292700c5bad6e2fc8ca5) Thanks [@asselstine](https://github.com/asselstine)! - Add `defaultAgentScale` config field to set the default number of concurrent runners for all agents. Agents without an explicit `[agents.<name>].scale` override will use this value instead of defaulting to 1. A warning is emitted at scheduler startup and by `al doctor` when the total requested scale exceeds the project-wide `scale` cap.

## 0.17.7

### Patch Changes

- [`e7ad42e`](https://github.com/Action-Llama/action-llama/commit/e7ad42e5868175f45b09b9a71140470992b9f677) Thanks [@asselstine](https://github.com/asselstine)! - Fix permission denied error when loading credentials in local Docker containers. The intermediate type directory (e.g. `/credentials/anthropic_key/`) was not chowned to the container user, causing EACCES on scandir.

## 0.17.6

### Patch Changes

- [`18920d0`](https://github.com/Action-Llama/action-llama/commit/18920d055fc474a5f389a80cd83ddac6c965f159) Thanks [@asselstine](https://github.com/asselstine)! - Return specific error messages from the trigger agent endpoint instead of a generic 404. The response now distinguishes between "agent not found", "no available runners", "scheduler paused", and "scheduler not ready", making it possible to diagnose trigger failures from the dashboard.

- [`8e83d39`](https://github.com/Action-Llama/action-llama/commit/8e83d390c847f6f69250cf7cf47493f32439e2ed) Thanks [@asselstine](https://github.com/asselstine)! - Add `-a`/`--all` flag to `al logs` to show all log levels without filtering. By default, conversation mode hides debug entries and internal messages; `--all` disables this filtering while keeping the readable conversation-style formatting.

- [`885c9cf`](https://github.com/Action-Llama/action-llama/commit/885c9cfeb4e56a3dd7f7390c1ef9376c834462e8) Thanks [@asselstine](https://github.com/asselstine)! - Fix EACCES permission error when containers read mounted credentials on VPS deployments. The SSH runtime now sets ownership of the credential staging directory to the container UID/GID after writing files, matching the behavior of the local runtime.

- [`e15bac4`](https://github.com/Action-Llama/action-llama/commit/e15bac44f663f99f2e45de27345ae9ae896cb0a0) Thanks [@asselstine](https://github.com/asselstine)! - Show full error details in `al logs` for container entry failures. Previously only the message "container entry error" was displayed with no detail; now the error message, stack trace, and any extra fields are shown.

## 0.17.5

### Patch Changes

- [`42fa395`](https://github.com/Action-Llama/action-llama/commit/42fa395278b2cdf78b048a63f407723a93e8f53d) Thanks [@asselstine](https://github.com/asselstine)! - Fix nginx config corruption during `al push` when config contains single quotes (e.g. `proxy_set_header Connection ''`). The heredoc uses a quoted delimiter so no shell escaping is needed — the prior escaping mangled the content and caused `nginx -t` to reject it. Also replaced the mock nginx binary in the e2e VPS container with real nginx so `nginx -t` actually validates config syntax.

## 0.17.4

### Patch Changes

- [`bf3ccc0`](https://github.com/Action-Llama/action-llama/commit/bf3ccc00ad47e7d4b06f28e0ebeb9be2dc2387d2) Thanks [@asselstine](https://github.com/asselstine)! - Fix dashboard "Disconnected" on deployed servers by disabling nginx proxy buffering for the SSE status-stream endpoint.

  - `al push` now generates a dedicated nginx `location /dashboard/api/status-stream` block with `proxy_buffering off`, `proxy_cache off`, and a 24-hour read timeout for long-lived SSE connections
  - Without this fix, nginx buffers SSE events and the browser's EventSource never receives data, causing the dashboard to show "Disconnected"

## 0.17.3

### Patch Changes

- [`1b64c4e`](https://github.com/Action-Llama/action-llama/commit/1b64c4e8e1ec3d6fab6cfdedd14b05150ddfbaa9) Thanks [@asselstine](https://github.com/asselstine)! - Strict config validation and webhook credential defaults.

  - `al doctor` now errors (not warns) on unknown fields in `config.toml` and agent SKILL.md frontmatter
  - Webhook sources default `credential` to `"default"` — no need to specify `credential = "default"` in config.toml
  - `scale` and `timeout` removed from agent SKILL.md frontmatter — use `[agents.<name>]` in config.toml instead
  - Fixed false "unknown fields" warnings for standard fields (`models.sonnet`, `name`, `credentials`, etc.)
  - Fixed duplicate `allowUnsigned` webhook warning logged twice on startup
  - Added `agents` and `historyRetentionDays` to the global config schema
  - Added e2e tests for the dashboard gateway (SSE stream, auth, API endpoints, control operations)

## 0.17.2

### Patch Changes

- [`7ac9f27`](https://github.com/Action-Llama/action-llama/commit/7ac9f276687e189d990fb355698c5c00380f4d61) Thanks [@asselstine](https://github.com/asselstine)! - Fix dashboard returning 404 after `al push`. The frontend SPA is now bundled
  into the published package so `resolveFrontendDist()` works outside the monorepo.
  Nginx config is updated on every push (not just when syncing credentials), and
  `/dashboard/api/` routes are proxied correctly instead of being caught by the
  SPA catch-all.

## 0.17.1

### Patch Changes

- [`5ef8a56`](https://github.com/Action-Llama/action-llama/commit/5ef8a56b21ac7e8bba2064388f0545a7c17b011f) Thanks [@asselstine](https://github.com/asselstine)! - Improve dashboard and TUI layout, fix several bugs:

  - Dashboard: remove stat cards, add side-by-side agent table + triggers layout, session time in token panel title, paused banner disables Run buttons, dropdown action menu on mobile, remove Recent Activity section
  - Dashboard: fix duplicate state text ("idleidle") in scaled agents, add trigger type column back to triggers table, use consistent uppercase table headers
  - Agent detail: move config section to skill page, add scale control and Kill button to header, fix running instances not clearing after completion
  - Skill page: show full agent configuration (schedule, models, credentials, webhook filters with all fields) above skill markdown with proper section headers
  - Instance page: fix locks not displaying (backend now returns `holder` field), add trigger type badge
  - TUI: show project scale in header
  - Frontend-wide: standardize instance ID display with ellipsis format (first 4 + … + last 4), ellipsis for long agent names on mobile

- [`4d28914`](https://github.com/Action-Llama/action-llama/commit/4d28914bd4dbf0d52305d6adea748c1c80666c3b) Thanks [@asselstine](https://github.com/asselstine)! - Fix dashboard button states: Kill button is now disabled when no instances are running, Run button is disabled when the agent is disabled, and disabled agent rows are visually dimmed. Also fix the double-count bug where clicking Run on a scale>1 agent showed "running 2/2" instead of "running 1/2". Add comprehensive Playwright e2e tests for the dashboard UI.

- [`ff6f4d8`](https://github.com/Action-Llama/action-llama/commit/ff6f4d8a210bc767796055e4d3869e3d085d89ad) Thanks [@asselstine](https://github.com/asselstine)! - Fix dashboard config page crashing with `require is not defined` by replacing the CommonJS `require()` call with a static ESM import for `getProjectScale`.

- [`fcf7e4d`](https://github.com/Action-Llama/action-llama/commit/fcf7e4d920ae084a232ca972f211109b9df4393c) Thanks [@asselstine](https://github.com/asselstine)! - Fix agent skill page markdown rendering where inline formatting (bold, italic, code, links) displayed as raw HTML tags instead of formatted text. The `renderInline()` function was escaping HTML after creating tags, nullifying its own output.

- [`667b574`](https://github.com/Action-Llama/action-llama/commit/667b574c44209d0a4fe06cf52e2adacf67910294) Thanks [@asselstine](https://github.com/asselstine)! - Fix session token counts always showing 0 on the dashboard. The pi-coding-agent SDK returns token data under `stats.tokens` (e.g., `stats.tokens.input`) but `sessionStatsToUsage()` was only checking `stats.usage`. Cost displayed correctly because `stats.cost` matched an existing fallback path.

- [`4b784b7`](https://github.com/Action-Llama/action-llama/commit/4b784b7f9244985977d1decc412044f51feb3585) Thanks [@asselstine](https://github.com/asselstine)! - Fix `al stat` crash when displaying running instances (`startedAt` from JSON is a string, not a Date) and exclude Playwright `.spec.ts` files from vitest so they don't fail the test suite.

- [`3d1f741`](https://github.com/Action-Llama/action-llama/commit/3d1f7414f5e9a1dbc06d6a8aae1feb0e9efb4afe) Thanks [@asselstine](https://github.com/asselstine)! - Fix token usage and return value tracking in container runs. The `forwardLogLine` method returned early for all `_log` JSON lines before reaching the `token-usage` and `signal-result` detection code, so these values were never captured. Moved detection into the `_log` handling block so metrics are correctly recorded.

- [`ac8909e`](https://github.com/Action-Llama/action-llama/commit/ac8909e7db324d49bf533596e7b3f0773ea71ab4) Thanks [@asselstine](https://github.com/asselstine)! - Merged the standalone E2E workflow into the CI workflow. E2E tests now run
  in parallel with unit/integration tests, and both must pass before triggering
  a deploy. The CI workflow also gains concurrency grouping and workflow_dispatch.

- [`b52ae5f`](https://github.com/Action-Llama/action-llama/commit/b52ae5f2c5a6a154ccbdc53f6dd8dd2ab6962935) Thanks [@asselstine](https://github.com/asselstine)! - Only load model extensions for providers referenced in `config.toml` `[models]`,
  instead of initializing all providers on startup. This eliminates noisy errors
  like "OpenAI API key is required" when a project only uses Anthropic.

- [`1d2c826`](https://github.com/Action-Llama/action-llama/commit/1d2c826c9fe0ff14556094d23810102addf03bc9) Thanks [@asselstine](https://github.com/asselstine)! - Replace the server-rendered HTML dashboard with a React SPA in a new `@action-llama/frontend` package (Vite, React 19, Tailwind CSS v4). The gateway serves the SPA with client-side routing and auth. All legacy HTML views (`src/control/views/`) are removed. On `al push`, the built frontend is deployed to the server and nginx serves static assets directly for efficiency.

## 0.17.0

### Minor Changes

- [#272](https://github.com/Action-Llama/action-llama/pull/272) [`22ae0e6`](https://github.com/Action-Llama/action-llama/commit/22ae0e6322fb877dbb523c4ff2aaabc2171ee86d) Thanks [@asselstine](https://github.com/asselstine)! - Added stable extension API for providers. This major refactoring promotes the existing provider patterns into a consistent extension system with central registry, credential requirements, and standardized lifecycle management.

  **New Extension Types:**

  - **Webhook Extensions**: Handle incoming webhook events (GitHub, Linear, Sentry, Mintlify, Test)
  - **Telemetry Extensions**: Send observability data (OpenTelemetry)
  - **Runtime Extensions**: Execute agents in different environments (Local Docker, SSH Docker)
  - **Model Extensions**: Provide LLM integration (OpenAI, Anthropic, Custom endpoints)
  - **Credential Extensions**: Store and retrieve secrets (File-based, HashiCorp Vault)

  **Extension API Features:**

  - Declarative credential requirements with validation
  - Custom credential type definitions
  - Centralized extension registry with type-safe access methods
  - Automatic extension loading with graceful error handling
  - Comprehensive documentation and examples

  **Migration Impact:**

  - Replaces hardcoded switch statements in telemetry and runtime factories
  - Maintains full backward compatibility with existing configurations
  - All built-in providers are automatically converted to extensions
  - No user-facing configuration changes required

  **Developer Benefits:**

  - Eliminates provider-specific conditionals in core codebase
  - Enables easy addition of new providers without modifying core
  - Provides foundation for future dynamic extension loading
  - Standardizes provider interfaces across all types

  See `docs/extensions.md` for complete API documentation and examples.

  Closes [#222](https://github.com/Action-Llama/action-llama/issues/222).

- [#275](https://github.com/Action-Llama/action-llama/pull/275) [`f4ad10d`](https://github.com/Action-Llama/action-llama/commit/f4ad10da325d000e0b626673e4edc1876bc578b5) Thanks [@asselstine](https://github.com/asselstine)! - Breaking: Remove automatic initial run of scheduled agents on startup

  Agents with schedules no longer run automatically when the service starts.
  They will only run on their configured schedule or when manually triggered.
  This prevents overwhelming the system on startup when many agents are configured.

### Patch Changes

- [#279](https://github.com/Action-Llama/action-llama/pull/279) [`4aa001b`](https://github.com/Action-Llama/action-llama/commit/4aa001bd46222e5e3fa4c0e9fcf7bb49338cb3c7) Thanks [@asselstine](https://github.com/asselstine)! - Added comprehensive agent configuration display and skill page to the dashboard. The agent detail page now shows complete configuration including models, credentials, schedule, webhooks, hooks, and custom parameters. A new "View Skill" page renders the agent's SKILL.md body content with markdown formatting. Closes [#267](https://github.com/Action-Llama/action-llama/issues/267).

- [`0f722c0`](https://github.com/Action-Llama/action-llama/commit/0f722c0d6020e05377de80d295a3ad29df2727bf) Thanks [@asselstine](https://github.com/asselstine)! - Add durable trigger history with webhook receipts. Every incoming webhook is now recorded in a `webhook_receipts` table with headers and body (up to 256 KB) for forensics and replay. Dead-letter webhooks (failed validation, no matching agent, parse errors) are tracked separately.

  **New features:**

  - Webhook receipt recording with deduplification via provider delivery IDs (e.g. `X-GitHub-Delivery`)
  - Unified trigger history view combining runs and dead-letter webhooks, available on the dashboard and via `GET /api/stats/triggers`
  - Full trigger history page at `/dashboard/triggers` with pagination and dead-letter toggle
  - Webhook replay endpoint: `POST /api/webhooks/:receiptId/replay` re-dispatches stored payloads
  - Configurable retention via `historyRetentionDays` in `config.toml` (default: 14 days, previously hardcoded to 90)

  **New config field:**

  - `historyRetentionDays` (integer, optional) — controls how long runs, call edges, and webhook receipts are kept

- [#308](https://github.com/Action-Llama/action-llama/pull/308) [`c15eb4e`](https://github.com/Action-Llama/action-llama/commit/c15eb4ea8b76bcfabc69c3389970cb15671f2911) Thanks [@asselstine](https://github.com/asselstine)! - Fix Docker image build failure detection in E2E tests. Added proper error logging and verification of required build artifacts before building Docker images. This prevents silent failures when build dependencies are missing and provides clear error messages when Docker builds fail. Closes [#307](https://github.com/Action-Llama/action-llama/issues/307).

- [#321](https://github.com/Action-Llama/action-llama/pull/321) [`bda94e0`](https://github.com/Action-Llama/action-llama/commit/bda94e0b788376346282dcd55925a061316d7700) Thanks [@asselstine](https://github.com/asselstine)! - Fixed E2E test Docker network IP assignment failure by explicitly connecting containers to network after startup and improving network IPAM configuration. This resolves CI failures where VPS containers couldn't obtain IP addresses from the test network. Closes [#320](https://github.com/Action-Llama/action-llama/issues/320).

- [#304](https://github.com/Action-Llama/action-llama/pull/304) [`a9ff0cd`](https://github.com/Action-Llama/action-llama/commit/a9ff0cd01c09c7450cb5e4be9705ff1f060deb58) Thanks [@asselstine](https://github.com/asselstine)! - Fix E2E test Docker network IP assignment and API key configuration issues. Increased container startup timeout from 2000ms to 5000ms to allow proper network setup and added test API keys to E2E workflow to prevent model provider initialization failures. Closes [#303](https://github.com/Action-Llama/action-llama/issues/303).

- [#310](https://github.com/Action-Llama/action-llama/pull/310) [`02b90bd`](https://github.com/Action-Llama/action-llama/commit/02b90bd5999422b7c83135b569efb0494856af4a) Thanks [@asselstine](https://github.com/asselstine)! - Fix E2E tests Docker network connectivity by restoring explicit network connection calls. This resolves the regression introduced in commit 2987ecc where containers were not properly connecting to the custom network, causing SSH connection timeouts and scheduler startup failures. Closes [#313](https://github.com/Action-Llama/action-llama/issues/313).

- [#319](https://github.com/Action-Llama/action-llama/pull/319) [`3aed20d`](https://github.com/Action-Llama/action-llama/commit/3aed20d62378839c8ea766d52dad7439f0f923bc) Thanks [@asselstine](https://github.com/asselstine)! - Fix E2E test SSH service startup timeout. Enhanced VPS container debugging with detailed startup logging, improved SSH connection timeout handling, and added health checks. Addresses SSH service failing to start within the 60-attempt timeout that was blocking all deployment-related E2E tests. Closes [#318](https://github.com/Action-Llama/action-llama/issues/318).

- [`43bedd0`](https://github.com/Action-Llama/action-llama/commit/43bedd066a2f521cc1f511643dfc000ffcf5115a) Thanks [@asselstine](https://github.com/asselstine)! - Fix `al push --no-creds` to skip credential validation entirely, including the ANTHROPIC_API_KEY requirement. Previously, `collectCredentialRefs` was called unconditionally which triggered model/provider validation even when `--no-creds` was specified.

- [`cf40204`](https://github.com/Action-Llama/action-llama/commit/cf402049750517d8db77c2951bbd2d8710b6646c) Thanks [@asselstine](https://github.com/asselstine)! - Remove the feedback feature that auto-modified agent SKILL.md files in response to errors. This removes the `[feedback]` config section, per-agent feedback overrides, the feedback monitor/runner, and all related dashboard and CLI UI.

- [`3c3943a`](https://github.com/Action-Llama/action-llama/commit/3c3943a78f40cad56d35edf1a587a84eab968ebb) Thanks [@asselstine](https://github.com/asselstine)! - Remove hardcoded model name allowlist that blocked valid newer models (e.g. Claude 4.x).
  Model names are now validated by the provider API at runtime instead of a stale local list.
  Also fix agent config validation to match the actual SKILL.md frontmatter structure,
  where `credentials` and `models` are nested under `metadata`.

- [`2918779`](https://github.com/Action-Llama/action-llama/commit/29187796b0911fc2f6811c68ce00b022ef77c0af) Thanks [@asselstine](https://github.com/asselstine)! - Instance detail page now shows richer trigger information: agent-triggered runs link to
  the parent instance, webhook-triggered runs display the source, event summary, and
  delivery ID from the stored receipt, and schedule-triggered runs show "Scheduled".
  Falls back to the previous flat-text display when underlying data has been pruned.

- [`9ec315d`](https://github.com/Action-Llama/action-llama/commit/9ec315d40b9b8d4cd02def02cc55d33a03d17948) Thanks [@asselstine](https://github.com/asselstine)! - Separate agent runtime tuning from agent definitions. Per-agent `scale` and `timeout` can now be overridden via `[agents.<name>]` sections in `.env.toml` or environment files, without modifying SKILL.md. Dashboard and TUI scale changes now write to `.env.toml` instead of rewriting SKILL.md, preventing remote/local config divergence after `al push`.

- [`d12b066`](https://github.com/Action-Llama/action-llama/commit/d12b0660c7f87f22be6ad447081750822253592a) Thanks [@asselstine](https://github.com/asselstine)! - Bake `shared/` directory into agent images. Files placed in `<project>/shared/` are now included in every agent's container at `/app/static/shared/`, allowing agents to reference common context (coding conventions, repo layout, policies) via direct context injection in SKILL.md (e.g., `!\`cat /app/static/shared/conventions.md\``).

- [`002bf6f`](https://github.com/Action-Llama/action-llama/commit/002bf6f3479e6c18ab4e7206dfeeec4d7a3057b4) Thanks [@asselstine](https://github.com/asselstine)! - Fix `al push` silently swallowing validation errors. When `al push` ran `al doctor` internally with `silent: true`, validation error details were suppressed but the summary "N validation error(s) found. See details above." was still thrown — leaving users with no actionable information. Errors are now always printed regardless of silent mode.

- [`2da001f`](https://github.com/Action-Llama/action-llama/commit/2da001f632d754e19f98b1fd3f5de58771392165) Thanks [@asselstine](https://github.com/asselstine)! - Allow `al push --headless --no-creds` to skip credential validation in doctor.
  Previously, headless mode would fail if required credentials were missing locally,
  even when `--no-creds` was passed to skip credential syncing. This enables CI/CD
  deploy workflows that only push code and agent configs without needing credentials
  on the runner.

## 0.16.0

### Minor Changes

- [#217](https://github.com/Action-Llama/action-llama/pull/217) [`5ad8a0e`](https://github.com/Action-Llama/action-llama/commit/5ad8a0e5fffc3c5ea546f51644315ce1743bbebf) Thanks [@asselstine](https://github.com/asselstine)! - Add comprehensive end-to-end testing package that validates complete user workflows. The new e2e package tests CLI interactions, web UI flows, and VPS deployment scenarios using containerized environments that closely mirror production setups. Tests run in GitHub Actions but are excluded from local npm test commands to avoid accidental execution.

- [#229](https://github.com/Action-Llama/action-llama/pull/229) [`a7724f7`](https://github.com/Action-Llama/action-llama/commit/a7724f75bbbd6cd35434ab73800f90a6c2b5e73a) Thanks [@asselstine](https://github.com/asselstine)! - Unify persistence story with event sourcing and unified storage layer

  Replaces the fragmented StateStore/StatsStore/WorkQueue pattern with a single unified persistence layer that combines key-value storage, event sourcing, and analytics capabilities. This architectural change enables features like replay, audit trails, and high availability without requiring parallel storage logic.

  **Key features:**

  - **Unified interface**: Single `PersistenceStore` combining KV operations, event sourcing, and queries
  - **Event sourcing**: Append-only event streams with replay capabilities for audit and analytics
  - **Multiple backends**: SQLite (default) and memory backends, designed for future cloud backends
  - **Backward compatibility**: Adapters for existing StateStore/StatsStore interfaces
  - **Migration utilities**: Automated migration from legacy stores with progress reporting
  - **Transaction support**: Atomic operations across KV and event operations
  - **Snapshots**: Performance optimization for large event streams

  **Architecture benefits:**

  - Natural audit trail for all system operations
  - Replay capabilities for debugging and analytics
  - Event-driven architecture foundation for real-time features
  - Consistent storage patterns across all components
  - Simplified deployment with single database file
  - Future-ready for distributed deployments

  **Migration path:**

  - Existing code continues working via compatibility adapters
  - Automatic migration utilities preserve all historical data
  - Gradual rollout allows incremental adoption
  - No breaking changes to public APIs

  The unified persistence layer provides a solid foundation for advanced features like real-time dashboards, distributed deployments, and comprehensive audit logging while maintaining the simplicity of Action Llama's single-file SQLite approach for local development.

### Patch Changes

- [#233](https://github.com/Action-Llama/action-llama/pull/233) [`3b9b3d0`](https://github.com/Action-Llama/action-llama/commit/3b9b3d0aca4e6b008ae8027ee53fb2b9801e5380) Thanks [@asselstine](https://github.com/asselstine)! - Refactored agent lifecycle management to use explicit state machines for both agent types and individual instances. This improves code clarity and reduces edge-case bugs around reruns, scaling, backpressure, and call depth by formalizing state transitions and validation logic.

  The changes introduce two new state machine classes: `InstanceLifecycle` for tracking individual agent runs and `AgentLifecycle` for managing agent type-level state. These are integrated with the existing StatusTracker and execution flow while maintaining backward compatibility with the existing API.

- [#243](https://github.com/Action-Llama/action-llama/pull/243) [`f03f650`](https://github.com/Action-Llama/action-llama/commit/f03f6509dcc0a7be0d1046caad2851b72f3a45b7) Thanks [@asselstine](https://github.com/asselstine)! - Fixed E2E test Docker build context paths. Corrected relative paths in harness.ts
  from `./packages/e2e/docker/local` and `./packages/e2e/docker/vps` to `./docker/local`
  and `./docker/vps` to resolve correctly when vitest runs from the packages/e2e directory.
  Fixes CI failures where E2E tests were timing out due to missing Dockerfiles.
  Closes [#242](https://github.com/Action-Llama/action-llama/issues/242).

- [#236](https://github.com/Action-Llama/action-llama/pull/236) [`2b785f0`](https://github.com/Action-Llama/action-llama/commit/2b785f0e4cdb0a6c2beaeed00ab6d9066e68ced5) Thanks [@asselstine](https://github.com/asselstine)! - Fix integration tests failing due to restrictive credential file permissions. Use more permissive permissions (0755 for directories, 0644 for files) in test mode while maintaining security with restrictive permissions (0700/0400) in production. Closes [#234](https://github.com/Action-Llama/action-llama/issues/234).

- [#230](https://github.com/Action-Llama/action-llama/pull/230) [`7187099`](https://github.com/Action-Llama/action-llama/commit/718709908d224a9497e93f145f7670d29a21c0a6) Thanks [@asselstine](https://github.com/asselstine)! - Improved credential security in Docker runtime by reducing file permissions from overly permissive (0755/0644) to more restrictive (0700/0400). Added support for setting container UID/GID ownership and basic tmpfs credential mounting strategy for enhanced security on multi-user systems. Closes [#224](https://github.com/Action-Llama/action-llama/issues/224).

- [`079ce6e`](https://github.com/Action-Llama/action-llama/commit/079ce6ebf56a71d0864084e6f9c60ebd372c57f3) Thanks [@asselstine](https://github.com/asselstine)! - Fix `al push` failing when `cloudflareHostname` is set: the Cloudflare origin certificate was not synced to the remote server during credential sync, causing nginx configuration to fail with "No such file or directory". The certificate is now included as an infrastructure credential during the sync phase.

- [#228](https://github.com/Action-Llama/action-llama/pull/228) [`f7ddf29`](https://github.com/Action-Llama/action-llama/commit/f7ddf29f34c1665e475307ee6cd88aa17fe539ce) Thanks [@asselstine](https://github.com/asselstine)! - Improve webhook security by denying unsigned webhooks by default. Previously, webhook sources without credentials would automatically accept unsigned requests. Now they are denied by default unless `allowUnsigned: true` is explicitly set in the webhook configuration. When `allowUnsigned: true` is used, a security warning is displayed on startup. This prevents accidental insecure production deployments while maintaining backward compatibility through the explicit opt-in flag.

  Closes [#225](https://github.com/Action-Llama/action-llama/issues/225).

## 0.15.0

### Minor Changes

- [#215](https://github.com/Action-Llama/action-llama/pull/215) [`3f70293`](https://github.com/Action-Llama/action-llama/commit/3f70293af1985d745d4c71931f82326370b2db81) Thanks [@asselstine](https://github.com/asselstine)! - Add feedback agent configuration system that automatically triggers agents to fix errors found in other agents' logs, with the ability to update their SKILL.md files.

  Features:

  - **Global feedback configuration** in project config with enabled/disabled toggle, error patterns, context lines, and custom feedback agent selection
  - **Per-agent feedback overrides** to enable/disable feedback for specific agents independently of global settings
  - **Built-in default feedback agent** that conservatively fixes only syntax errors and formatting issues while preserving original agent intent
  - **Automatic log monitoring** that detects error patterns in agent logs and triggers feedback agents with relevant context
  - **SKILL.md validation and backup** when feedback agents make corrections
  - **CLI configuration** via `al agent config` command with feedback override options
  - **Web UI configuration** with project-wide feedback settings and per-agent toggles
  - **Conservative approach** - feedback agents only fix clear technical issues, never alter agent behavior or functionality

  The feedback system helps maintain agent health by automatically detecting and fixing common SKILL.md syntax errors, YAML formatting issues, and obvious typos that can cause agent failures.

  Closes [#213](https://github.com/Action-Llama/action-llama/issues/213)

### Patch Changes

- [#210](https://github.com/Action-Llama/action-llama/pull/210) [`bbd1eeb`](https://github.com/Action-Llama/action-llama/commit/bbd1eeb788436147245e6ddda877486d8368b48e) Thanks [@asselstine](https://github.com/asselstine)! - Add resource lock display to dashboard agents table and instance detail pages. Agents table now shows a "Locks" column displaying currently held resource locks, and instance detail pages include a "Resource Locks" section. Lock data is fetched from the gateway API every 2 seconds for real-time updates. Closes [#204](https://github.com/Action-Llama/action-llama/issues/204).

- [#212](https://github.com/Action-Llama/action-llama/pull/212) [`2275fa0`](https://github.com/Action-Llama/action-llama/commit/2275fa0969b8edaac235105de0868ae6099e4e9d) Thanks [@asselstine](https://github.com/asselstine)! - Added scale configuration controls to both TUI and web interface. Users can now:

  - View and modify project-wide scale (max concurrent agent runs) in a new configuration page
  - View and modify agent-specific scale (concurrent runners per agent) in agent configuration
  - TUI: Press 'C' to open project config, 'A' to open agent config for the selected agent
  - Web: Click "Config" button on dashboard to access project settings, agent scale controls on agent detail pages

  Closes [#203](https://github.com/Action-Llama/action-llama/issues/203).

- [#211](https://github.com/Action-Llama/action-llama/pull/211) [`1b76963`](https://github.com/Action-Llama/action-llama/commit/1b7696313640ff904a01127eae023826f7b4b74c) Thanks [@asselstine](https://github.com/asselstine)! - Filter Session Instances section on agent detail page to only show running instances. Changed section title from "Session Instances" to "Running Instances" to clarify the filtering. Completed instances remain visible in the Instance History table below.

- [#208](https://github.com/Action-Llama/action-llama/pull/208) [`5eb4427`](https://github.com/Action-Llama/action-llama/commit/5eb44274e02255a3a006a87e0865ee20e5c5fbdc) Thanks [@asselstine](https://github.com/asselstine)! - Fix instance detail page to show proper status for running instances instead of misleading "Instance not found" message. The page now displays telemetry availability message and running instance information when an agent is currently executing. Closes [#205](https://github.com/Action-Llama/action-llama/issues/205)

## 0.14.1

### Patch Changes

- [`51b475e`](https://github.com/Action-Llama/action-llama/commit/51b475eabde69d5a1b1e3ada00fe6973b7adcaf4) Thanks [@asselstine](https://github.com/asselstine)! - Fix release workflow failing because `prepublishOnly` called `npm test` which doesn't exist in the workspace package. Build and test now run explicitly at the monorepo root in CI before publishing.

## 0.14.0

### Minor Changes

- [`3dc2cfe`](https://github.com/Action-Llama/action-llama/commit/3dc2cfefedb4a7a3f63c01ceeb1e46060a5a52f1) Thanks [@asselstine](https://github.com/asselstine)! - Align agent configuration with the Agent Skills specification.

  - Replace ACTIONS.md + agent-config.toml with a single SKILL.md file. All agent
    config (credentials, schedule, hooks, params, model) lives in YAML frontmatter.
    The markdown body is the agent's instructions.
  - Replace the preflight provider system with simple shell command hooks.
    `hooks.pre` runs before the LLM session, `hooks.post` runs after.
  - Add `!` backtick context injection in SKILL.md body — inline shell commands
    whose output is injected into the prompt at startup.
  - Rename agent-to-agent call commands: `al-call` → `al-subagent`,
    `al-check` → `al-subagent-check`, `al-wait` → `al-subagent-wait`.
  - Add `description` field to agents, surfaced in `al stat`, web dashboard,
    chat, and subagent catalog.
  - Align name validation: 64-char limit, reject consecutive hyphens.

- [`d0b904a`](https://github.com/Action-Llama/action-llama/commit/d0b904a825048024e2abf125bfc96619469a7e73) Thanks [@asselstine](https://github.com/asselstine)! - Replaced singular `[model]` config with named models (`[models.<name>]`) and model
  fallback chains. Define models once in `config.toml`, reference by name in SKILL.md
  frontmatter (`models: [sonnet, haiku]`). First model is primary; the rest are tried
  automatically on rate limits via an in-memory circuit breaker. Breaking change: the
  old `[model]` section in config.toml and inline `model:` block in SKILL.md are removed.

- [`5c40e0e`](https://github.com/Action-Llama/action-llama/commit/5c40e0e1ed25d6534e3a04706365eb993562f8af) Thanks [@asselstine](https://github.com/asselstine)! - Nest AL-specific SKILL.md fields under `metadata` key for platform compatibility.

  Action Llama's custom frontmatter fields (`credentials`, `models`, `schedule`, `webhooks`, `hooks`, `params`, `scale`, `timeout`) now live under a `metadata` key in SKILL.md. Top-level fields `description`, `license`, and `compatibility` remain at the top level as they are allowed by the external platform. This is a breaking change to the SKILL.md format — existing SKILL.md files must be updated to the new structure.

- [#193](https://github.com/Action-Llama/action-llama/pull/193) [`8ea439e`](https://github.com/Action-Llama/action-llama/commit/8ea439e2b38821714916f177c356269c0d6219d5) Thanks [@asselstine](https://github.com/asselstine)! - Resource locks now require valid URIs as resource keys. The lock system will validate that resource keys follow proper URI format with valid schemes (e.g., github://, https://, file://). This ensures consistency and prevents malformed lock keys.

  **Breaking change:** Agents using non-URI resource keys (such as "github issue owner/repo#123") will need to update their lock keys to proper URI format (such as "github://owner/repo/issues/123"). The lock skill documentation has been updated with proper URI examples.

### Patch Changes

- [`8aae8b9`](https://github.com/Action-Llama/action-llama/commit/8aae8b9d520b39b74bbbe6320cf6a49a63e0a5ce) Thanks [@asselstine](https://github.com/asselstine)! - Added MCP server for Claude Code integration. Run `al mcp serve` to start a stdio-based
  MCP server that exposes tools for starting/stopping the scheduler, triggering agent runs,
  viewing logs, and checking status — all from within Claude Code. New projects created with
  `al new` include a `.mcp.json` file so Claude Code discovers the server automatically.
  For existing projects, run `al mcp init` to add it.

- [`59f510c`](https://github.com/Action-Llama/action-llama/commit/59f510cb212da9f587342954b0814a2b6c6b6da3) Thanks [@asselstine](https://github.com/asselstine)! - Added Claude Code slash commands bootstrapped into new projects. Five commands
  (/new-agent, /run, /debug, /iterate, /status) help developers build and iterate
  on agents from Claude Code. Run `al claude init` to add them to existing projects.

- [`26311f7`](https://github.com/Action-Llama/action-llama/commit/26311f7d8d186bfe896125f24fdb5889c9c15563) Thanks [@asselstine](https://github.com/asselstine)! - Restructure web dashboard with Tailwind CSS, light/dark mode, and three-level hierarchy.

  The dashboard now has three levels: top-level overview, agent detail (with paginated instance history and aggregate stats from StatsStore), and instance detail (with run metadata, token breakdown, and live log viewer). Removed redundant Mode, Runtime, and Uptime stats from the top-level header. Added `/api/stats/agents/:name/runs` and `/api/stats/agents/:name/runs/:instanceId` endpoints for paginated run history. Old `/dashboard/agents/:name/logs` URLs redirect to the new agent detail page.

- [`a03374e`](https://github.com/Action-Llama/action-llama/commit/a03374e64697ed39aa61c326acd3b34d8dd2fb80) Thanks [@asselstine](https://github.com/asselstine)! - Include file paths in config parse errors. YAML frontmatter errors (SKILL.md) and TOML parse errors (config.toml, .env.toml, environment files) now show which file contains the syntax error.

- [`05ab386`](https://github.com/Action-Llama/action-llama/commit/05ab3866dc68521beb1d4b89dd47287fc2147238) Thanks [@asselstine](https://github.com/asselstine)! - Fix instance log route rejecting valid instance IDs. The `/api/logs/agents/:name/:instanceId` endpoint expected only the hex suffix but the dashboard passes the full instance ID (e.g., `planner-e778111c`). The route now treats the instance ID as an opaque string and uses it directly as the log filter.

- [#197](https://github.com/Action-Llama/action-llama/pull/197) [`f3530dc`](https://github.com/Action-Llama/action-llama/commit/f3530dc1d3e3f29dc384b1a27e9ad6af83b45ab1) Thanks [@asselstine](https://github.com/asselstine)! - Fixed MCP server agent info display to show all configured models instead of failing with TypeScript error. The server now correctly accesses the `models` array property instead of the non-existent `model` property. Closes [#196](https://github.com/Action-Llama/action-llama/issues/196).

- [`fa2cbb4`](https://github.com/Action-Llama/action-llama/commit/fa2cbb4747d4fd1848c7c7a1f1160039840514fb) Thanks [@asselstine](https://github.com/asselstine)! - Restructured the project into an npm workspaces monorepo with three packages:
  `@action-llama/action-llama` (CLI, published), `@action-llama/shared` (shared types, private),
  and `@action-llama/docs` (Mintlify docs, private). This is a structural change with no
  behavior differences — all existing functionality, configuration, and Docker builds work identically.

- [`d4227be`](https://github.com/Action-Llama/action-llama/commit/d4227bec29ea9b6981c60175ec316976ec036068) Thanks [@asselstine](https://github.com/asselstine)! - Added local SQLite telemetry store (`.al/stats.db`) that persists agent run history
  across scheduler restarts. Records duration, token usage, cost, hook timing, and
  agent-to-agent call edges. View with `al stats [agent]`, `al stats --calls`, or
  `al stats --json`. Data auto-prunes after 90 days.

  Also renamed `al stat` to `al status` (`stat` remains as an alias for backward
  compatibility), and added post-hook execution to the host agent runner.

- [`0e3afaa`](https://github.com/Action-Llama/action-llama/commit/0e3afaaf977d78f638c2bf288e587447d2bb0fec) Thanks [@asselstine](https://github.com/asselstine)! - Moved lock timeout config from `gateway.lockTimeout` to top-level `resourceLockTimeout`
  for clarity. The setting controls how long resource locks live before expiring (default
  1800s / 30 minutes). The old `gateway.lockTimeout` field is no longer recognized.

- [`e5643f3`](https://github.com/Action-Llama/action-llama/commit/e5643f3dd52df7deaf6fae73ac04f732294c69c8) Thanks [@asselstine](https://github.com/asselstine)! - Improve `al doctor` webhook validation: validate that webhook source types are known providers (catches typos like "githib"), warn when non-test webhook sources have no credential configured (accepts unsigned webhooks), and fix missing Linear/Mintlify entries in credential collection so their webhook secrets are properly checked.
