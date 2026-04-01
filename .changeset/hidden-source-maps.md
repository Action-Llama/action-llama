---
"@action-llama/action-llama": patch
---

Switch frontend source maps to "hidden" mode so `.map` files are generated but not referenced in bundled JS, preventing browsers from auto-fetching them in production.
