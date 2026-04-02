---
"@action-llama/action-llama": patch
---

Fix: Call server.closeAllConnections() before server.close() to force-close keep-alive connections, preventing integration test suite hangs with 160+ test files
