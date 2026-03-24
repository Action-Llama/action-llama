# @action-llama/action-llama

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
