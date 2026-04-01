---
"@action-llama/action-llama": minor
---

`al logs` now accepts a full instance ID as the positional argument (e.g. `al logs e2e-coverage-improver-b80a62dd`), automatically detecting and extracting the agent name and instance suffix. The `-i, --instance` flag has been removed; use the positional instance ID instead.
