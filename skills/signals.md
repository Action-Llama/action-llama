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

## `[TRIGGER: <agent>]...[/TRIGGER]`

Triggers another agent with context you provide.

```
[TRIGGER: reviewer]
I just opened PR #42 on acme/app. Please review it.
URL: https://github.com/acme/app/pull/42
[/TRIGGER]
```

**When to use:** When your work creates something another agent should act on — e.g. a dev agent opens a PR and wants a reviewer agent to review it.

**Format:** The opening tag must be on its own line: `[TRIGGER: <agent-name>]`. The closing tag must also be on its own line: `[/TRIGGER]`. Everything between them becomes the context passed to the target agent.

**Rules:**
- You cannot trigger yourself — self-triggers are silently skipped
- If the target agent doesn't exist or is busy, the trigger is skipped
- Trigger chains are bounded by `maxTriggerDepth` (default: 3) to prevent infinite loops
- The target agent receives your context in an `<agent-trigger>` block with your agent name as the `source`

## Multiple signals

You can emit multiple signals in one run. For example, you might emit several `[STATUS]` updates as you work, then a `[TRIGGER]` at the end, and a `[RERUN]` if there's more work to do.
