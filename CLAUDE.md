# CLAUDE.md

## Project

Action Llama — CLI tool for running LLM agents as scripts (cron/webhook triggered).

This is a monorepo with the following packages:

| Package | Path | Published | Description |
|---------|------|-----------|-------------|
| `@action-llama/action-llama` | `packages/action-llama` | npm | CLI tool, gateway, scheduler, agent runners |
| `@action-llama/shared` | `packages/shared` | no (private) | Shared TypeScript types and pure utility functions |
| `@action-llama/docs` | `packages/docs` | no (private) | Mintlify documentation site |
| `@action-llama/e2e` | `packages/e2e` | no (private) | End-to-end tests for complete user workflows |

## Build & Test

```bash
npm run build          # build shared, then action-llama
npm run test:unit      # unit tests only (fast, run during development)
npm test               # all tests including integration (run before committing)
npm run test:integration  # integration tests only (Docker-based, slow)
npm run test:watch     # watch mode (unit tests only)
npm run test:coverage  # V8 coverage
```

Build order: `shared` first (both web and cli will depend on it), then `action-llama`.

Tests live in `packages/action-llama/test/` mirroring `packages/action-llama/src/`. Integration tests are in `test/integration/` and require Docker. When asked to run tests, run `npm test` (the full suite) unless explicitly told to run only unit tests. Use `npm run test:unit` only when iterating during development.

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

**How to create a changeset (non-interactive):**

The `npx changeset add` CLI is interactive and cannot be fully automated. To create changesets non-interactively (e.g., from scripts or AI agents), write the file directly:

```bash
cat > .changeset/<short-name>.md << 'EOF'
---
"@action-llama/action-llama": patch
---

Short human-readable description of what changed and why.
EOF
```

Use a random short kebab-case name (e.g., `cool-dogs-fly.md`). The file format is:

```markdown
---
"@action-llama/action-llama": patch
---

Description of the change for the changelog.
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
- Releases publish to the `latest` dist-tag on npm
- The release workflow (`release.yml`) is triggered manually via workflow_dispatch — it versions packages, runs tests, and publishes to `latest`

## Key Conventions

- Config format: TOML for project config (`config.toml`, `.env.toml`, environment files) and per-agent runtime config (`agents/<name>/config.toml`); YAML frontmatter in `SKILL.md` for portable agent metadata (name, description, license, compatibility) with markdown instructions
- Credentials: `~/.action-llama/credentials/<type>/<instance>/<field>` — instance is agent name (agent-specific) or `"default"` (shared)
- Cloud is opt-in via `--env <name>` flag or `.env.toml` environment binding; server deploy via `al push --env <name>`
- `"default"` is a reserved name — cannot be used as an agent name
- Tests use vitest with `test/` mirroring `src/`
- **Secret prompts**: When prompting for API keys, tokens, or any secret value, **always** use `password` from `@inquirer/prompts` with `mask: "*"` — never use plaintext `input`. See `packages/action-llama/src/credentials/prompter.ts` for the canonical pattern.
- **Persistence**: Use the unified persistence layer (`src/shared/persistence/`) for all storage needs. It combines key-value operations, event sourcing, and query capabilities with support for multiple backends (SQLite, memory).

## Package Details

See `packages/action-llama/CLAUDE.md` for CLI/gateway/scheduler internals, source layout, and configuration system details.
