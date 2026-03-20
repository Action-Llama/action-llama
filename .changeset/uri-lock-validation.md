---
"@action-llama/action-llama": minor
---

Resource locks now require valid URIs as resource keys. The lock system will validate that resource keys follow proper URI format with valid schemes (e.g., github://, https://, file://). This ensures consistency and prevents malformed lock keys.

**Breaking change:** Agents using non-URI resource keys (such as "github issue owner/repo#123") will need to update their lock keys to proper URI format (such as "github://owner/repo/issues/123"). The lock skill documentation has been updated with proper URI examples.