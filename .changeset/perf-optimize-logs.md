---
"@action-llama/action-llama": patch
---

Optimized `al logs` command performance for faster log reading. Improved local log file reading with reverse-read algorithm that turns O(file) operations into O(N), direct filename computation to skip directory scans for common cases, and file watching instead of polling for follow mode. Enhanced dashboard log streaming with async file operations and fs.watch() instead of 500ms polling. Optimized CloudWatch log queries with time-bounded searches starting from narrow windows. These changes provide significant performance improvements, especially for large log files. Closes #72.