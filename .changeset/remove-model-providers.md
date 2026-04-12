---
"@action-llama/action-llama": patch
---

Remove duplicate model provider implementations in favour of Pi's native model registry. Deletes `src/models/` (Anthropic, OpenAI, and custom providers), removes `ModelExtension` from the extension system, and eliminates the `ModelCircuitBreaker` fallback logic. `al doctor` now validates model provider/ID pairs directly against Pi's `getModel()`. Log summarisation routes call the LLM APIs directly rather than through the removed provider layer.
