---
"@action-llama/action-llama": patch
---

Added persistent state store for scheduler runtime state (container registry, resource locks,
work queues, inter-agent calls). Uses SQLite locally and DynamoDB in cloud mode. This fixes
a bug where the cloud scheduler lost track of running containers after an App Runner restart,
causing "invalid secret" errors when agents tried to acquire resource locks. `al cloud setup`
now automatically provisions the DynamoDB table (`al-state`) and grants the required permissions.
