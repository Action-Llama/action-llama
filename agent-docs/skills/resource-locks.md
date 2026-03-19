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
- Possible deadlock: `{"ok":false,"reason":"possible deadlock: ...","deadlock":true,"cycle":[...]}` (exit 1) — a deadlock cycle was detected. Release your locks and back off. See [Deadlock detection](#deadlock-detection).

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

- **Always `rlock` before starting work** on a shared resource (issues, PRs, deployments).
- **Always `runlock` when done.** Locks are auto-released when your container exits, but explicit unlock is cleaner.
- **If `rlock` exits non-zero (or returns `{"ok":false,...}`), skip that resource.** Do not wait, retry, or proceed without the lock — move on to the next item.
- **If `rlock` returns `deadlock: true`, release your locks and back off.** See [Deadlock detection](#deadlock-detection) below.
- **Use `rlock-heartbeat` during long operations** to keep the lock alive. Each heartbeat resets the TTL.
- **Locks expire after 30 minutes** by default (configurable via `gateway.lockTimeout` in `config.toml`). If you don't heartbeat and the lock expires, another instance can claim it.
- When `GATEWAY_URL` is not set (single-instance mode), lock commands return `{"ok":true}` as a no-op (exit 0). When `GATEWAY_URL` is set but the gateway is unreachable, lock commands exit 6 — you must not proceed.

## Multiple locks

You can hold multiple locks simultaneously. This is useful when your workflow requires coordinating across several resources:

```
rlock "github issue acme/app#42"
rlock "deploy api-prod"
# ... work that needs both the issue and the deployment slot ...
runlock "deploy api-prod"
runlock "github issue acme/app#42"
```

Release each lock as soon as you no longer need it. Holding locks longer than necessary increases the chance of contention and deadlocks.

## Deadlock detection

When multiple agents each hold a lock the other needs, a **deadlock** can occur. The scheduler detects these cycles automatically.

**Example:**
- Agent A holds lock on `issue #1`, tries to acquire `issue #2` (held by Agent B)
- Agent B holds lock on `issue #2`, tries to acquire `issue #1` (held by Agent A)
- Neither can proceed — deadlock

When a cycle is detected, `rlock` returns exit 1 with:

```json
{"ok":false,"reason":"possible deadlock: agent-a → issue #2 → agent-b → issue #1 → agent-a","deadlock":true,"cycle":["agent-a","issue #2","agent-b","issue #1"]}
```

**What to do when you see `deadlock: true`:**

1. Release one or more of your currently held locks (`runlock`)
2. Move on to other work, or wait briefly before retrying
3. The other agent(s) will be able to proceed once you release

The `cycle` array describes the chain: `[holderA, resourceX, holderB, resourceY, ...]`. Check the JSON output for the `deadlock` field to distinguish deadlocks from regular contention.

## Example workflow

```
1. List open issues labeled "agent"
2. For each issue:
   - rlock "github issue acme/app#42"
   - If ok is false and deadlock is true, runlock any held locks and retry later
   - If ok is false, skip — another instance is handling it
   - Clone, branch, implement, push, open PR
   - runlock "github issue acme/app#42"
3. If you completed work and there may be more issues, run `al-rerun`
```
