# Contributing

## Commits

Use [conventional commits](https://www.conventionalcommits.org/):

```
<type>: <description>
```

| Type       | When to use |
|------------|-------------|
| `feat`     | New feature or capability |
| `fix`      | Bug fix |
| `refactor` | Code change that doesn't fix a bug or add a feature |
| `chore`    | Dependency updates, config changes, tooling |
| `docs`     | Documentation only |
| `test`     | Adding or fixing tests |
| `perf`     | Performance improvement |
| `ci`       | CI/CD changes |

## Changesets

Every PR with user-facing changes **must** include a changeset. This is how the changelog and version bumps are generated.

### Creating a changeset

Add a markdown file to `.changeset/` with any short kebab-case name:

```
.changeset/add-custom-providers.md
```

File format:

```markdown
---
"@action-llama/action-llama": patch
---

Added support for custom LLM providers via `provider: "custom"` in
SKILL.md frontmatter. Point `baseUrl` to any OpenAI-compatible endpoint.
Closes #27.
```

### Bump types (pre-1.0)

| Bump    | Meaning | Example |
|---------|---------|---------|
| `patch` | Fixes, small features, internal changes | `0.4.2` → `0.4.3` |
| `minor` | Breaking changes, major features | `0.4.2` → `0.5.0` |

Most changes are `patch`. Use `minor` only for breaking changes or large features.

### Writing good changeset descriptions

- Describe the change from the **user's perspective**
- Mention new CLI flags, config fields, or behavioral changes
- Reference issue numbers where applicable
- 1-3 sentences is usually enough

### When to skip a changeset

No changeset needed for:
- Internal refactors with no behavior change
- Test-only or CI-only changes
- Documentation-only changes

## Release process

Releases use a two-tier model: **daily → `next`**, **manual promote → `latest`**.

### Daily releases (`next` tag)

1. Merge PRs to `main` with changesets
2. Daily at 08:00 UTC, GitHub Actions runs the release workflow
3. If pending changesets exist, a "release PR" is opened (or updated) with version bump + changelog
4. When the release PR merges, the package is published to npm under the **`latest`** dist-tag

Install: `npm install @action-llama/action-llama`

You can trigger a release manually via the GitHub Actions UI (workflow_dispatch on the Release workflow).

## Development

```bash
npm install
npm run build
npm test
```

Tests live in `test/` mirroring `src/`. Run the full suite before pushing.
