---
"@action-llama/action-llama": patch
---

Replaced the nginx gateway proxy container with Docker's built-in `--add-host gateway:host-gateway`, simplifying container-to-host networking and removing the `startGatewayProxy`/`stopGatewayProxy` runtime methods. Added a health-check retry loop in the container entry so agents wait for the gateway to become reachable before proceeding.

Added a typed scheduler event bus for lifecycle instrumentation (run start/end, locks, calls, signals, webhooks), request/response logging middleware on all gateway routes, and al-call lifecycle tracking in the scheduler so call status is updated when triggered runs complete.

Improved container command exit codes: added HTTP 500/502/504 mappings to `_http-exit` and standardized usage errors to exit code 9. Rewrote integration tests to use event-driven assertions instead of polling, with proper exit code and JSON validation in shell test scripts.
