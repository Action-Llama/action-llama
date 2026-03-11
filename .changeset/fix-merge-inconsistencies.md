---
"@action-llama/action-llama": patch
---

Fixed several inconsistencies introduced during recent refactorings:

- Wired control routes (`pause`, `resume`, `kill`) into the gateway so CLI commands work at runtime
- Removed stale `--no-docker` references from error messages (flag was removed in #59)
- Config now reads `maxCallDepth` and `workQueueSize` with fallback to deprecated field names
- Replaced `any` types with proper `StatusTracker` imports in status-reporter, execution-engine, and runtime-factory
- Removed dead `trigger-parser.ts` (duplicate of logic in runner.ts, never imported)
- Updated AGENTS.md skills reference to reflect current signal/command names
