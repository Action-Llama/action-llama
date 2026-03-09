# Skill: Resource Locks

When multiple instances of your agent run in parallel (`scale > 1`), resource locks prevent two instances from working on the same thing (same issue, same PR, same deployment).

Locks are only available in Docker mode. Each lock is identified by a **resource key** — a free-form string you choose.

## Operations

### LOCK(resourceKey)

Acquire an exclusive lock before working on a shared resource.

```
curl -s -X POST $GATEWAY_URL/locks/acquire \
  -H 'Content-Type: application/json' \
  -d '{"secret":"'$SHUTDOWN_SECRET'","resourceKey":"<resourceKey>"}'
```

**Responses:**
- Acquired: `{"ok":true,"resourceKey":"..."}`
- Conflict: `{"ok":false,"holder":"<other-agent>","heldSince":...}` (HTTP 409) — another instance has it. Skip this resource.
- Already holding another lock: `{"ok":false,"reason":"already holding lock on ..."}` (HTTP 409) — release your current lock first.

### UNLOCK(resourceKey)

Release a lock when you're done with the resource.

```
curl -s -X POST $GATEWAY_URL/locks/release \
  -H 'Content-Type: application/json' \
  -d '{"secret":"'$SHUTDOWN_SECRET'","resourceKey":"<resourceKey>"}'
```

**Response:** `{"ok":true}`

### HEARTBEAT(resourceKey)

Extend the TTL on a lock you hold. Use during long-running work to prevent expiry.

```
curl -s -X POST $GATEWAY_URL/locks/heartbeat \
  -H 'Content-Type: application/json' \
  -d '{"secret":"'$SHUTDOWN_SECRET'","resourceKey":"<resourceKey>"}'
```

**Response:** `{"ok":true,"expiresAt":...}`

## Resource key conventions

Use descriptive, unique keys that identify the exact resource:

| Pattern | Example |
|---------|---------|
| `github issue owner/repo#number` | `LOCK("github issue acme/app#42")` |
| `github pr owner/repo#number` | `LOCK("github pr acme/app#17")` |
| `deploy service-name` | `LOCK("deploy api-prod")` |

## Rules

- **One lock at a time.** You can hold at most one lock. UNLOCK before acquiring a different resource.
- **Always LOCK before starting work** on a shared resource (issues, PRs, deployments).
- **Always UNLOCK when done.** Locks are auto-released when your container exits, but explicit unlock is cleaner.
- **If a LOCK fails, skip that resource.** Do not wait or retry — move on to the next item.
- **Use HEARTBEAT during long operations** to keep the lock alive. Each heartbeat resets the TTL.
- **Locks expire after 30 minutes** by default (configurable via `gateway.lockTimeout` in `config.toml`). If you don't heartbeat and the lock expires, another instance can claim it.

## Example workflow

```
1. List open issues labeled "agent"
2. For each issue:
   - LOCK("github issue acme/app#42")
   - If the lock fails, skip — another instance is handling it
   - Clone, branch, implement, push, open PR
   - UNLOCK("github issue acme/app#42")
3. If no issues to work on, respond with [SILENT]
```
