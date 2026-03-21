---
"@action-llama/action-llama": patch
---

Add resource lock display to dashboard agents table and instance detail pages. Agents table now shows a "Locks" column displaying currently held resource locks, and instance detail pages include a "Resource Locks" section. Lock data is fetched from the gateway API every 2 seconds for real-time updates. Closes #204.