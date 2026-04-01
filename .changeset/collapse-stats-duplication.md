---
"@action-llama/action-llama": patch
---

Collapse queryActivityRows/countActivityRows duplication: extract shared filter builder into private _buildActivityFilter(), add queryActivityRowsWithCount() combining both operations with a window function for improved efficiency (one DB call instead of two)
