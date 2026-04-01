---
"@action-llama/frontend": patch
---

Virtualized the ActivityTable component for better performance with large activity lists. Replaced `<table>` markup with `<div>`-based flexbox layout, extracted memoized ActivityRowItem component, moved per-row UI state into individual row components, and added row virtualization using @tanstack/react-virtual. Only visible rows are now rendered, significantly improving performance when scrolling through many activities. Closes #538.
