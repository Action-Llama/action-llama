# Skill: Agent-to-Agent Calls

Call other agents and retrieve their results. These commands are available in Docker mode only.

## Commands

### `al-call <agent>`

Dispatch a call to another agent. Pass context via stdin.

```
echo "Review PR #42 on acme/app" | al-call reviewer
```

**Response:** `{"ok":true,"callId":"<uuid>"}`

**Exit codes:** 0=dispatched, 1=rejected, 3=auth error, 4=missing arg, 5=no gateway, 6=unreachable, 7=unexpected — see [exit code table](#exit-codes)

### `al-check <callId>`

Non-blocking status check on a dispatched call.

```
al-check "abc-123"
```

**Response:** `{"status":"pending|running|completed|error","returnValue":"...","errorMessage":"..."}`

**Exit codes:** 0=found, 2=not found, 3=auth error, 4=missing arg, 5=no gateway, 6=unreachable, 7=unexpected — see [exit code table](#exit-codes)

### `al-wait <callId> [...] [--timeout N]`

Block until one or more calls complete. Default timeout: 900 seconds.

```
al-wait "abc-123" "def-456" --timeout 300
```

**Response:** JSON object keyed by callId, each value is the call status object.

**Exit codes:** 0=all complete, 4=missing arg, 5=no gateway, 8=timeout — see [exit code table](#exit-codes)

## Patterns

### Fire and wait

```sh
CALL_ID=$(echo "Review PR #42 on acme/app" | al-call reviewer | jq -r .callId)
RESULT=$(al-wait "$CALL_ID")
REVIEW=$(echo "$RESULT" | jq -r ".[\"$CALL_ID\"].returnValue")
```

### Fan-out

```sh
ID1=$(echo "Check API tests" | al-call tester | jq -r .callId)
ID2=$(echo "Check UI tests" | al-call tester | jq -r .callId)
RESULTS=$(al-wait "$ID1" "$ID2" --timeout 600)
```

### Handle rejection

```sh
RESP=$(echo "context" | al-call target-agent)
EXIT=$?
if [ "$EXIT" -eq 1 ]; then
  echo "Call rejected: $(echo "$RESP" | jq -r .reason)"
elif [ "$EXIT" -ne 0 ]; then
  echo "Call failed with exit $EXIT"
fi
```

## Rules

- An agent cannot call itself
- If the target is busy, the call is queued until a runner frees up
- Call chains are limited by `maxCallDepth` in `config.toml` (default: 3)
- Use `al-return` to send a result back to the calling agent

## Exit Codes

All gateway-calling shell commands share a common exit code scheme. See the [Shell Command Exit Codes](../AGENTS.md#shell-command-exit-codes) section in AGENTS.md for the full table.
