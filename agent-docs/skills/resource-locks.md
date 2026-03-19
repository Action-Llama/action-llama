# Skill: Resource Locks

When multiple instances of your agent run in parallel (`scale > 1`), resource locks prevent two instances from working on the same thing (same issue, same PR, same deployment).

Each lock is identified by a **resource key** — a free-form string you choose.

## Commands

### `rlock <resourceKey>`

Acquire an exclusive lock before working on a shared resource.

```
rlock "github issue acme/app#42"
```

**Responses:**
- Acquired: `{"ok":true}` (exit 0)
- Conflict: `{"ok":false,"holder":"<other-agent>","heldSince":...}` (exit 1) — another instance has it. Skip this resource.
- Already holding another lock: `{"ok":false,"reason":"already holding lock on ..."}` (exit 1) — release your current lock first.

**Exit codes:** 0=acquired, 1=conflict, 3=auth error, 9=missing arg, 6=unreachable, 7=unexpected — see [exit code table](../AGENTS.md#shell-command-exit-codes)

### `runlock <resourceKey>`

Release a lock when you're done with the resource.

```
runlock "github issue acme/app#42"
```

**Response:** `{"ok":true}` (exit 0)

**Exit codes:** 0=released, 1=conflict (held by another), 2=not found, 3=auth error, 9=missing arg, 6=unreachable, 7=unexpected — see [exit code table](../AGENTS.md#shell-command-exit-codes)

### `rlock-heartbeat <resourceKey>`

Extend the TTL on a lock you hold. Use during long-running work to prevent expiry.

```
rlock-heartbeat "github issue acme/app#42"
```

**Response:** `{"ok":true,"expiresAt":...}` (exit 0)

**Exit codes:** 0=extended, 1=conflict (held by another), 2=not found, 3=auth error, 9=missing arg, 6=unreachable, 7=unexpected — see [exit code table](../AGENTS.md#shell-command-exit-codes)

## Resource key conventions

Use descriptive, unique keys that identify the exact resource:

| Pattern | Example |
|---------|---------|
| `github issue owner/repo#number` | `rlock "github issue acme/app#42"` |
| `github pr owner/repo#number` | `rlock "github pr acme/app#17"` |
| `deploy service-name` | `rlock "deploy api-prod"` |

## Rules

- **One lock at a time.** You can hold at most one lock. `runlock` before acquiring a different resource.
- **Always `rlock` before starting work** on a shared resource (issues, PRs, deployments).
- **Always `runlock` when done.** Locks are auto-released when your container exits, but explicit unlock is cleaner.
- **If `rlock` exits non-zero (or returns `{"ok":false,...}`), skip that resource.** Do not wait, retry, or proceed without the lock — move on to the next item.
- **Use `rlock-heartbeat` during long operations** to keep the lock alive. Each heartbeat resets the TTL.
- **Locks expire after 30 minutes** by default (configurable via `gateway.lockTimeout` in `config.toml`). If you don't heartbeat and the lock expires, another instance can claim it.
- When `GATEWAY_URL` is not set (single-instance mode), lock commands return `{"ok":true}` as a no-op (exit 0). When `GATEWAY_URL` is set but the gateway is unreachable, lock commands exit 6 — you must not proceed.

## Example workflow

```
1. List open issues labeled "agent"
2. For each issue:
   - rlock "github issue acme/app#42"
   - If ok is false, skip — another instance is handling it
   - Clone, branch, implement, push, open PR
   - runlock "github issue acme/app#42"
3. If you completed work and there may be more issues, run `al-rerun`
```
