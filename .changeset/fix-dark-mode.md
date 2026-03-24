---
"@action-llama/action-llama": patch
---

Fix dark mode toggle in web dashboard. Tailwind CSS v4 defaults to
`prefers-color-scheme` media queries, so the class-based `.dark` toggle
had no effect. Added `@custom-variant dark` directive to enable
class-based dark mode.
