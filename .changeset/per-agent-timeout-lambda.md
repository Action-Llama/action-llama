---
"@action-llama/action-llama": patch
---

Added per-agent timeout support and automatic AWS Lambda routing. Agents can now set
`timeout` in `agent-config.toml` (falls back to global `[local].timeout`, then 900s).
For the ECS cloud provider, agents with timeout <= 900s automatically route to Lambda
for faster cold starts and lower cost, while longer-running agents stay on ECS Fargate.
New config fields: `lambdaRoleArn`, `lambdaSubnets`, `lambdaSecurityGroups` in `[cloud]`.
`al doctor -c` now creates Lambda execution roles for short-timeout agents.
