# Skill: Signals

Signals are text patterns you emit in your output. The scheduler scans your output for these patterns and acts on them. They are your only communication channel back to the scheduler.

## `[RERUN]`

Tells the scheduler you did work and there may be more to do — requests an immediate rerun.

```
[RERUN]
```

**When to use:** When you completed work (e.g. processed an issue, merged a PR) and there may be additional items in the backlog. The scheduler will immediately re-run you (up to `maxReruns` times) to drain remaining work.

**When NOT to use:** If you found no work to do, or if you completed work but the backlog is empty. Simply end without emitting `[RERUN]` and the scheduler will wait for the next scheduled run.

**Default behavior:** Without `[RERUN]`, the scheduler treats your run as complete and does not rerun. This is the safe default — errors, rate limits, and empty runs won't trigger unwanted reruns.

## `[STATUS: <text>]`

Sends a status update to the TUI and logs.

```
[STATUS: reviewing PR #42]
[STATUS: deploying api-prod]
[STATUS: waiting for CI checks]
```

**When to use:** At natural milestones during your work — starting a new phase, switching tasks, or waiting on something. Helps the operator see what you're doing in real time.

**Format:** The text between `[STATUS:` and `]` is extracted verbatim. Keep it short and descriptive.

## `[RETURN]...[/RETURN]`

Returns a value to the calling agent when you were invoked via `al-call`.

```
[RETURN]
PR looks good. Approved with minor suggestions:
- Line 42: consider using a const instead of let
- Line 89: missing error handling for the API call
[/RETURN]
```

**When to use:** When you were called by another agent (you'll see an `<agent-call>` block in your prompt) and need to send back a result. Place your return value between the tags.

**Format:** The opening `[RETURN]` and closing `[/RETURN]` must each be on their own line. Everything between them is returned verbatim to the caller.

**Rules:**
- Only the last `[RETURN]...[/RETURN]` block in your output is used (if you emit multiple, earlier ones are overwritten)
- If you were not called by another agent, `[RETURN]` blocks are ignored
- Call chains are bounded by `maxCallDepth` (default: 3) to prevent infinite loops

## `[EXIT]` and `[EXIT: <code>]`

Terminates the agent with an optional exit code, indicating an unrecoverable error or intentional abort.

```
[EXIT: 10] GitHub token is invalid or expired
[EXIT: 11] Permission denied accessing repository
[EXIT: 15] Unrecoverable error in build system
[EXIT]
```

**When to use:** When encountering errors that cannot be resolved by retrying — authentication failures, permission issues, invalid configuration, or when you need to abort due to user request or safety concerns.

**Format:** Use `[EXIT]` for a generic unrecoverable error (exit code 15) or `[EXIT: <code>]` to specify a standard exit code.

**Standard exit codes:**
- `10` — Authentication/credentials failure
- `11` — Permission/access denied
- `12` — Rate limit exceeded
- `13` — Configuration error
- `14` — Missing dependency or service error
- `15` — Generic unrecoverable error (default)
- `16` — User-requested abort

**Behavior:** The agent terminates immediately with the specified exit code. The scheduler will not retry automatically. This replaces the fragile string-matching approach for detecting unrecoverable errors.

**When NOT to use:** For transient errors (network timeouts, temporary rate limits) or normal completion. Use normal error handling or simply complete the run instead.

## Multiple signals

You can emit multiple signals in one run. For example, you might emit several `[STATUS]` updates as you work, then a `[RETURN]` block with your result, and a `[RERUN]` if there's more work to do.
