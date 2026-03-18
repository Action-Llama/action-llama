---
"@action-llama/action-llama": patch
---

Fixed VPS provisioning getting stuck at "Waiting for SSH..." when Hetzner or Vultr
recycles an IP address from a previously deprovisioned server. The stale host key in
`~/.ssh/known_hosts` caused silent SSH connection failures. Now clears the old
known_hosts entry before the first SSH attempt. Also added progress dots during SSH
retry phase so the CLI no longer appears frozen.
