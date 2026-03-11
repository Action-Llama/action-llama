---
"@action-llama/action-llama": patch
---

Added support for resource locks when running the scheduler and agent containers locally. The system now automatically creates a gateway proxy container that enables containers to communicate with the host's gateway service across all platforms (Linux, Mac, Windows). This fixes resource locking functionality for local Docker deployments. Closes #57.