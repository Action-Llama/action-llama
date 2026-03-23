---
"@action-llama/action-llama": patch
---

Fixed E2E test Docker network IP assignment failure by explicitly connecting containers to network after startup and improving network IPAM configuration. This resolves CI failures where VPS containers couldn't obtain IP addresses from the test network. Closes #320.