---
"@action-llama/action-llama": patch
---

Debug and bulletproof API logging pagination with instance filtering.

- Export MAX_SCAN_LINES from log-helpers.ts to enable testing and mocking in test suites
- Add comprehensive tests for instance-filtered log pagination including:
  - Initial load with instance filter returns correct entries and cursor
  - Forward pagination with cursor picks up new entries after initial load
  - Backward pagination with large files and small MAX_SCAN_LINES limits
  - Backward pagination across multiple daily files with instance filter
  - Invalid back_cursor returns proper 400 error
  - Instance filtering works correctly with large interleaved logs
  - Backward pagination respects instance filter with multiple daily files
- Verify API handles edge cases for instance-filtered backward and forward pagination (closes #550)
