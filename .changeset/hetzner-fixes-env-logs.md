---
"@action-llama/action-llama": patch
---

Added `al env logs <name>` command to view server system logs via SSH, with `-n` for
recent line count and `-f` to follow in real-time.

Fixed Hetzner VPS provisioning: corrected the `firewalls` request body format to match
the API spec (`[{"firewall": id}]`), switched location availability checks from the
`prices` array to the `locations` array with per-location deprecation filtering, added
pagination to all Hetzner list endpoints, filtered out deprecated server types, and
fixed price display formatting.
