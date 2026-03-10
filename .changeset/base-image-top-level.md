---
"@action-llama/action-llama": patch
---

Show base image build progress as a single top-level TUI status line instead of
duplicating it under every agent. Previously, each agent row showed identical
"Base image: ..." status text during the shared base image build.
