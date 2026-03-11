# Skill: Signals

Use signals to communicate with the scheduler and trigger actions.

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

## `al-trigger <agent> "<context>"`

Triggers another agent with context you provide.

```
al-trigger reviewer "I just opened PR #42 on acme/app. Please review it. URL: https://github.com/acme/app/pull/42"
```

**When to use:** When your work creates something another agent should act on — e.g. a dev agent opens a PR and wants a reviewer agent to review it.

**Format:** Provide the target agent name and context as arguments. The context should be quoted and contain all necessary information.

**Rules:**
- You cannot trigger yourself — self-triggers are silently ignored
- If the target agent doesn't exist or is busy, the trigger is skipped
- Trigger chains are bounded by `maxTriggerDepth` (default: 3) to prevent infinite loops
- The target agent receives your context in an `<agent-trigger>` block with your agent name as the `source`

## Responses

All signal commands return JSON responses:
- Success: `{"ok":true}`
- Error: `{"ok":false,"error":"<message>"}`

## Multiple signals

You can call multiple signal commands in one run. For example, you might call `al-status` several times as you work, then `al-trigger` at the end, and `al-rerun` if there's more work to do.

## Graceful degradation

Commands gracefully degrade when `GATEWAY_URL` is not set (return success as no-op). This allows agents to work in both containerized and host environments.
