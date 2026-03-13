---
"@action-llama/action-llama": patch
---

Added OpenTelemetry integration with support for trace instrumentation and AWS X-Ray integration. Configure telemetry in `config.toml` with `[telemetry]` section to enable observability for scheduler operations, agent executions, webhook processing, and HTTP gateway requests. Supports local OpenTelemetry collectors and AWS X-Ray via ADOT sidecars on ECS deployments. Telemetry is disabled by default to avoid unexpected network traffic. Closes #69.