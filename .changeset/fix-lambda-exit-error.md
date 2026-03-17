---
"@action-llama/action-llama": patch
---

Fixed Lambda agents failing with `Runtime.ExitError` by removing `process.exit()` calls
from the Lambda handler. The handler was exiting before Lambda finished processing the
invocation response, causing a race condition. The Runtime API loop now continues naturally,
allowing Lambda to freeze the environment between invocations.
