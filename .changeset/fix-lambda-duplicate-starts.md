---
"@action-llama/action-llama": patch
---

Fixed Lambda agents starting repeatedly on failure. AWS Lambda's async invocation
auto-retries (default 2) caused duplicate container starts that the scheduler didn't
control. Now sets `MaximumRetryAttempts: 0` on each Lambda function. Also fixed stale
CloudWatch log replay by filtering `streamLogs` and `waitForExit` to only read logs
from the current invocation's launch time.
