---
"@action-llama/action-llama": patch
"@action-llama/frontend": patch
---

Fix two instance log bugs: (1) older instance logs no longer disappear — backend `readLastEntries` now scans up to 50k lines instead of stopping at `limit*3`, so sparse instance entries are found even when many newer-instance lines follow; (2) the logs panel pre-fetches one older page on load to provide scroll headroom above the initially visible entries.
