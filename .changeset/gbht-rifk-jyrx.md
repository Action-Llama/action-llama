---
"@action-llama/action-llama": patch
---

Fix overlapping columns in the dashboard Recent Triggers table. The `table-fixed` layout caused columns with `w-[1%]` to collapse to near-zero width, making headers and data visually overlap.
