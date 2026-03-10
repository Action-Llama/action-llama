---
"@action-llama/action-llama": patch
---

Fixed Lambda container images timing out during init phase. The container entry
point now implements the Lambda Runtime API protocol via a dedicated handler
(`lambda-handler.ts`), keeping the init phase lightweight. The Lambda function's
ENTRYPOINT is overridden via `ImageConfig` so Docker/ECS containers are unaffected.
