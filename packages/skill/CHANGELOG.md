# @action-llama/skill

## 0.26.8

## 0.26.7

### Patch Changes

- [#556](https://github.com/Action-Llama/action-llama/pull/556) [`6c2022f`](https://github.com/Action-Llama/action-llama/commit/6c2022fe996f92ed8cdaaf5e0b35275d495c5451) Thanks [@asselstine](https://github.com/asselstine)! - Fix: Instance logs not showing full history due to backCursor race condition in frontend polling logic. Increased initial log batch size from 100 to 200 to match API default. Added comprehensive test coverage for backward pagination across date boundaries.

## 0.26.6

## 0.26.5

## 0.26.4

## 0.26.3

## 0.26.2

## 0.26.1

## 0.26.0

## 0.25.0

## 0.24.3

## 0.24.2

## 0.24.1

## 0.24.0

## 0.23.8

## 0.23.7

### Patch Changes

- [`90fa493`](https://github.com/Action-Llama/action-llama/commit/90fa49380da515753d1203b50e941244dc68e0f5) Thanks [@asselstine](https://github.com/asselstine)! - Fix npm publish for @action-llama/skill by setting public access in publishConfig.

## 0.23.6

## 0.23.5

### Patch Changes

- [`225df08`](https://github.com/Action-Llama/action-llama/commit/225df08dca0e467cc0236eb6f6e94f4bb757847d) Thanks [@asselstine](https://github.com/asselstine)! - Extract AI integration content (AGENTS.md, MCP config, Claude Code commands) into new `@action-llama/skill` package. Scaffolded projects now depend on `@action-llama/skill` and receive content updates via `npm update` instead of re-scaffolding.

- [`fa48b28`](https://github.com/Action-Llama/action-llama/commit/fa48b28d16070d3eaa463c417a3e24b374735c09) Thanks [@asselstine](https://github.com/asselstine)! - Sync skill package version with action-llama and add fixed versioning so both packages always release together.
