---
"@action-llama/action-llama": patch
---

Surface error details when the API returns `stop_reason="error"`. Previously the session-ended log only showed `stopReason: "error"` with no detail; now it extracts and includes the error message from the API response.
