---
"@action-llama/action-llama": minor
---

Reduce duplicated orchestration between host and container runners

- Extract shared `RunResult`, `RunOutcome`, `TriggerRequest` types into `src/agents/types.ts`
- Create `src/agents/session-loop.ts` with shared model-fallback + session-creation + event-subscription loop
- Refactor `container-entry.ts` and `cli/commands/run-agent.ts` to use the shared session loop
- Extract shared container monitoring logic into `ContainerAgentRunner.monitorContainer()` private method, used by both `run()` and `adoptContainer()`
- Remove dead code: `src/agents/runner.ts` (`AgentRunner` class) and `src/agents/execution-engine.ts` (`ExecutionEngine` class) were unused in production
- Add tests for `session-loop.ts`
