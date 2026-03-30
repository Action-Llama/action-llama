---
"@action-llama/action-llama": patch
---

Fix webhooks and manual triggers being dropped during the initial Docker image build phase. Incoming triggers are now queued and processed once the build completes. Closes #391.
