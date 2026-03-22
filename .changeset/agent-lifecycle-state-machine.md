---
"@action-llama/action-llama": patch
---

Refactored agent lifecycle management to use explicit state machines for both agent types and individual instances. This improves code clarity and reduces edge-case bugs around reruns, scaling, backpressure, and call depth by formalizing state transitions and validation logic.

The changes introduce two new state machine classes: `InstanceLifecycle` for tracking individual agent runs and `AgentLifecycle` for managing agent type-level state. These are integrated with the existing StatusTracker and execution flow while maintaining backward compatibility with the existing API.