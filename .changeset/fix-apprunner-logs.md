---
"@action-llama/action-llama": patch
---

Fixed cloud scheduler logs command (`al logs -c`) not working due to incorrect App Runner log group naming convention. The function now dynamically discovers the correct CloudWatch log group pattern used by App Runner services and provides better error messaging when the service is not deployed or no logs are available yet.