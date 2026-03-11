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

## Multiple signals

You can emit multiple signals in one run. For example, you might emit several `[STATUS]` updates as you work, then a `[RETURN]` block with your result, and a `[RERUN]` if there's more work to do.
