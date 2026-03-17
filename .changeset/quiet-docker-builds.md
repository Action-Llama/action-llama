---
"@action-llama/action-llama": patch
---

Fix Docker build output leaking into TUI during `al start`. Switched
`buildImage()` from synchronous `execFileSync` with inherited stderr to async
`spawn` with all stdio piped. BuildKit output is now parsed and forwarded
through `onProgress` instead of printing directly to the terminal, so the
Ink-based TUI can render cleanly during builds. Also piped stderr in the
`image.ts` helper used by `al run`.
