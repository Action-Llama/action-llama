---
"@action-llama/action-llama": patch
---

Move integration tests from action-llama package into the e2e package so that
`npm test` runs only fast unit tests. Integration tests are now available via
`npm run test:integration` which delegates to the e2e workspace. Added
`./internals/*` subpath exports to expose internal modules needed by the
integration harness.
