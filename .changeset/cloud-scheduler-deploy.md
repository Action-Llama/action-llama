---
"@action-llama/action-llama": minor
---

Added `al cloud deploy` to deploy the scheduler itself to the cloud as a long-running service.
For AWS/ECS projects, the scheduler runs on App Runner; for GCP/Cloud Run projects, it runs
as a Cloud Run service. The scheduler image is built with all project config and agent
definitions baked in, and the entrypoint runs `al start -c --headless --gateway`.

New config fields `cloud.schedulerCpu` and `cloud.schedulerMemory` control instance sizing
(defaults: 0.25 vCPU / 512 MB for App Runner, 1 vCPU / 512 Mi for Cloud Run).
AWS deployments also accept `cloud.appRunnerInstanceRoleArn` and `cloud.appRunnerAccessRoleArn`.

`al cloud teardown` now tears down the scheduler service in addition to per-agent IAM resources.
`al status -c` shows scheduler service status (URL, state, creation time).
`al logs scheduler -c` tails the cloud scheduler's logs.

The scheduler reads `GATEWAY_URL` env var to resolve its own webhook endpoint URL when
running in the cloud, avoiding the chicken-and-egg problem with service URLs.
