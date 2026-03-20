# CLAUDE.md

## Project

Action Llama — CLI tool for running LLM agents as scripts (cron/webhook triggered).

Package: `@action-llama/action-llama`, CLI binary: `al`.

## Build & Test

```bash
npm run build          # TypeScript build
npm run test:unit      # unit tests only (fast, run during development)
npm test               # all tests including integration (run before committing)
npm run test:integration  # integration tests only (Docker-based, slow)
npm run test:watch     # watch mode (unit tests only)
npm run test:coverage  # V8 coverage
```

Tests live in `test/` mirroring `src/`. Integration tests are in `test/integration/` and require Docker. When asked to run tests, run `npm test` (the full suite) unless explicitly told to run only unit tests. Use `npm run test:unit` only when iterating during development.

## Commits & Changesets

This project uses **conventional commits** and **changesets** for versioning.

### Commit message format

Do **not** add `Co-Authored-By` or any trailer lines to commits. Commits should be authored solely by the committer.

```
<type>: <short description>

[optional body with more detail]
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `ci`

Examples:
- `feat: add organization-level webhook filtering`
- `fix: handle missing credentials in cloud mode`
- `refactor: extract prompt builder into separate module`
- `chore: update AWS SDK dependencies`

### Changesets (required for every PR with user-facing changes)

Every PR that changes behavior, fixes a bug, or adds a feature **must** include a changeset file. Changesets are how we track what changed between versions and generate the changelog.

**How to create a changeset:**

Create a new markdown file in `.changeset/` with a random short name (e.g., `.changeset/cool-dogs-fly.md`). The file format is:

```markdown
---
"@action-llama/action-llama": patch
---

Short human-readable description of what changed and why.
Include enough context that someone reading the changelog understands
the change without looking at the diff.
```

**Bump type rules (pre-1.0):**

- `patch` — bug fixes, small features, internal improvements, dependency updates
- `minor` — breaking changes, significant new features, API changes

We are pre-1.0 (`0.x.y`), so `minor` = what would be `major` post-1.0. Most changes are `patch`.

**What to write in the description:**

- Lead with what changed from a user's perspective
- Mention new config fields, CLI flags, or behavioral changes
- Reference the issue number if applicable (e.g., "Closes #42")
- Keep it to 1-3 sentences

Good:
```markdown
---
"@action-llama/action-llama": patch
---

Added support for custom LLM providers. Set `provider: "custom"` in SKILL.md
frontmatter with a `baseUrl` pointing to any OpenAI-compatible endpoint. Closes #27.
```

Bad:
```markdown
---
"@action-llama/action-llama": patch
---

Updated code.
```

**When to skip a changeset:**

- Pure internal refactors with zero behavior change
- Test-only changes
- CI/docs-only changes
- Changes to `.gitignore`, `CLAUDE.md`, etc.

### PR workflow summary

1. Make changes on a branch
2. Write conventional commit messages
3. Add a `.changeset/<name>.md` file describing the change
4. Open PR — CI runs build + tests
5. On merge to main, the daily release workflow picks up changesets

## Versioning & Releases

- Pre-1.0: `0.MINOR.PATCH`
- **Daily releases** publish to the `next` dist-tag on npm (not `latest`)
- The daily workflow (`release.yml`) runs at 08:00 UTC — if changesets exist, it opens a release PR; when merged, it publishes to `next`
- **Promoting to `latest`**: run `npm run promote` locally, or trigger the "Promote to latest" workflow in GitHub Actions
- Users on `npm install @action-llama/action-llama` get the last promoted stable version
- Users on `npm install @action-llama/action-llama@next` get the latest daily build

## Source Layout

```
src/
  cli/              # Command definitions (--env flag, env subcommand)
  setup/            # Project scaffolding
  scheduler/        # Scheduler: agent discovery, cron + webhooks
  agents/           # Agent runners (host + Docker), prompt builder
  gateway/          # HTTP server: router, health, shutdown, webhook routes
  docker/           # Container lifecycle, image + network
  cloud/            # Cloud providers: vps/ (Vultr, Hetzner, SSH), cloudflare/
  remote/           # SSH push deploy: ssh/rsync helpers, bootstrap, push orchestration
  webhooks/         # Webhook registry, provider interface
  tui/              # Ink-based terminal UI
  shared/           # Config, credentials, environment, logger, paths, git helpers
```

## Configuration

Config uses a three-layer merge system for portable projects:

1. **`config.toml`** (committed) — portable project settings: `[model]`, `[local]`, `[gateway]`, `[webhooks]`, `[telemetry]`
2. **`.env.toml`** (gitignored) — per-project environment binding + config overrides. Has an `environment` field to select a named environment
3. **`~/.action-llama/environments/<name>.toml`** (machine-level) — infrastructure config: `[server]` (SSH push deploy), plus `gateway.url`, `telemetry.endpoint`

Merge order: `config.toml` -> `.env.toml` -> environment file (later values win, deep merge).

`[cloud]` and `[server]` must be in an environment file (Layer 3) — placing `[cloud]` in `config.toml` is an error. `[cloud]` and `[server]` are mutually exclusive within an environment.

Cloud mode is auto-detected from the merged config (presence of `[cloud]` section). Server mode uses `al push` with `[server]`. The `-E`/`--env <name>` flag or `AL_ENV` env var selects an environment explicitly.

Environment types (for `al env init <name> --type <type>`): `server`.

## Key Conventions

- Config format: TOML for project config (`config.toml`, `.env.toml`, environment files); YAML frontmatter in `SKILL.md` for agent config
- Credentials: `~/.action-llama/credentials/<type>/<instance>/<field>` — instance is agent name (agent-specific) or `"default"` (shared)
- Cloud is opt-in via `--env <name>` flag or `.env.toml` environment binding; server deploy via `al push --env <name>`
- `"default"` is a reserved name — cannot be used as an agent name
- Tests use vitest with `test/` mirroring `src/`
- **Secret prompts**: When prompting for API keys, tokens, or any secret value, **always** use `password` from `@inquirer/prompts` with `mask: "*"` — never use plaintext `input`. See `src/credentials/prompter.ts` for the canonical pattern.
