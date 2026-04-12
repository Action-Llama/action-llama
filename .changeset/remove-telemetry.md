---
"@action-llama/action-llama": patch
---

Remove OpenTelemetry integration. The `[telemetry]` config section and all OTel tracing instrumentation have been removed. If you had `[telemetry]` in your `config.toml`, remove it — unknown fields will log a warning.
