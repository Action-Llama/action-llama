---
"@action-llama/action-llama": patch
---

Restructured the project into an npm workspaces monorepo with three packages:
`@action-llama/action-llama` (CLI, published), `@action-llama/shared` (shared types, private),
and `@action-llama/docs` (Mintlify docs, private). This is a structural change with no
behavior differences — all existing functionality, configuration, and Docker builds work identically.
