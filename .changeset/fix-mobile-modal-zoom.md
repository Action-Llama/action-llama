---
"@action-llama/action-llama": patch
---

Fix iOS Safari auto-zoom when RunModal opens on mobile and make modal full-screen on small screens.

iOS Safari zooms the viewport when a focused `<input>` or `<textarea>` has `font-size < 16px`. The RunModal auto-focuses its textarea on mount, immediately triggering the zoom. A global CSS rule now enforces `font-size: 16px` for all form controls on screens under 768px, preventing this across the entire app (RunModal, LoginPage, ChatPage, DashboardPage). The RunModal card is also made full-screen on mobile for a cleaner experience, while preserving the centered card layout on larger screens. Closes #350.
