---
"@action-llama/action-llama": patch
---

Fix `--no-creds` flag on `al push` which was silently ignored due to three bugs:
Commander's `--no-` prefix handling mapped the flag to `opts.creds = false` instead of
`opts.noCreds = true`, the credential sync logic didn't consult the flag at all, and
the doctor webhook security check ran before the `skipCredentials` guard. Renamed the
CLI flag to `--skip-creds` to avoid Commander's negation semantics, gated `syncCreds`
on `!opts.noCreds`, and moved the webhook secret check inside the `skipCredentials`
block.
