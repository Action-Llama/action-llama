---
"@action-llama/action-llama": patch
---

Separated unit and integration test suites using vitest projects. `npm run test:unit` runs
only fast unit tests, `npm run test:integration` runs Docker-based integration tests with
process isolation and 180s timeout, and `npm test` runs both. Watch mode is scoped to unit tests.
