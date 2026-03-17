---
"@action-llama/action-llama": patch
---

Fixed outdated Dockerfile examples in `al chat` context and AGENTS.md that used
`apt-get` (Debian) instead of `apk` (Alpine), matching the actual `node:20-alpine`
base image. Also updated credential reference examples to use the current simple
syntax (`"github_token"`) instead of the deprecated `"type:instance"` format, and
corrected the base image tool list to include `jq`.
