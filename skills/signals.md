# Skill: Signals

Use signal commands to communicate with the scheduler and trigger actions. These commands write signal files to `$AL_SIGNAL_DIR` and optionally POST to the gateway for real-time TUI updates.

## Commands

**`al-rerun`** — Request an immediate rerun after completing work.

```
al-rerun
```

**When to use:** When you completed work (e.g. processed an issue, merged a PR) and there may be additional items in the backlog. The scheduler will immediately re-run you (up to `maxReruns` times) to drain remaining work.

**When NOT to use:** If you found no work to do, or if you completed work but the backlog is empty. Simply end without calling `al-rerun` and the scheduler will wait for the next scheduled run.

**Default behavior:** Without `al-rerun`, the scheduler treats your run as complete and does not rerun. This is the safe default — errors, rate limits, and empty runs won't trigger unwanted reruns.

## `al-status "<text>"`

Updates your status displayed in the TUI and logs.

```
al-status "reviewing PR #42"
al-status "deploying api-prod"
al-status "waiting for CI checks"
```

**When to use:** At natural milestones during your work — starting a new phase, switching tasks, or waiting on something. Helps the operator see what you're doing in real time.

**Format:** Provide the status text as a quoted argument. Keep it short and descriptive.

## `al-return`

Returns a value to the calling agent when you were invoked via `al-call`.

```
al-return "PR looks good. Approved with minor suggestions."
```

For multiline results, pipe via stdin:

```
cat <<'EOF' | al-return
PR looks good. Approved with minor suggestions:
- Line 42: consider using a const instead of let
- Line 89: missing error handling for the API call
EOF
```

**When to use:** When you were called by another agent (you'll see an `<agent-call>` block in your prompt) and need to send back a result. Pass your return value as an argument or pipe it via stdin.

**Rules:**
- If you call `al-return` multiple times, the last value wins
- If you were not called by another agent, `al-return` is a no-op
- Call chains are bounded by `maxCallDepth` (default: 3) to prevent infinite loops

## `al-exit [code]`

Terminates the agent with an optional exit code, indicating an unrecoverable error or intentional abort.

```
al-exit 10    # GitHub token is invalid or expired
al-exit 11    # Permission denied accessing repository
al-exit 15    # Unrecoverable error in build system
al-exit       # Defaults to 15 (unrecoverable error)
```

**When to use:** When encountering errors that cannot be resolved by retrying — authentication failures, permission issues, invalid configuration, or when you need to abort due to user request or safety concerns.

**Format:** Pass the exit code as an argument, or omit for code 15 (unrecoverable error).

**Standard exit codes:**
- `10` — Authentication/credentials failure
- `11` — Permission/access denied
- `12` — Rate limit exceeded
- `13` — Configuration error
- `14` — Missing dependency or service error
- `15` — Generic unrecoverable error (default)
- `16` — User-requested abort

**Behavior:** The agent terminates with the specified exit code. The scheduler will not retry automatically.

**When NOT to use:** For transient errors (network timeouts, temporary rate limits) or normal completion. Use normal error handling or simply complete the run instead.

## Responses

All signal commands return JSON responses:
- Success: `{"ok":true}`
- Error: `{"ok":false,"error":"<message>"}`

## Multiple signals

You can use multiple signal commands in one run. For example, you might run several `al-status` updates as you work, then `al-return` with your result, and `al-rerun` if there's more work to do.

## Graceful degradation

Commands gracefully degrade when `GATEWAY_URL` is not set — signal files are always written, but real-time TUI updates only work when a gateway is available. This allows agents to work in both containerized and host environments.
