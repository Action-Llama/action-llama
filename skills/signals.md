# Skill: Signals

Signals are text patterns you emit in your output. The scheduler scans your output for these patterns and acts on them. They are your only communication channel back to the scheduler.

## `[SILENT]`

Tells the scheduler you found no work to do.

```
[SILENT]
```

**When to use:** When you check for work (issues, PRs, alerts) and find nothing actionable. This is how the scheduler knows you're idle — it logs "no work to do" and skips further processing of your output.

**Effect on reruns:** On scheduled runs, a `[SILENT]` response stops the rerun loop. Without it, the scheduler assumes you did productive work and immediately re-runs you (up to `maxReruns` times). Always emit `[SILENT]` when there's nothing to do.

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

You can emit multiple signals in one run. For example, you might emit several `[STATUS]` updates as you work, then a `[TRIGGER]` at the end. `[SILENT]` should only appear alone — if you did work, don't emit `[SILENT]`.
