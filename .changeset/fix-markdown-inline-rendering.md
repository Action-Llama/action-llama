---
"@action-llama/action-llama": patch
---

Fix agent skill page markdown rendering where inline formatting (bold, italic, code, links) displayed as raw HTML tags instead of formatted text. The `renderInline()` function was escaping HTML after creating tags, nullifying its own output.
