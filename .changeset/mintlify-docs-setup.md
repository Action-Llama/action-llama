---
"@action-llama/action-llama": patch
---

Set up Mintlify docs site. Added `docs/docs.json` config and `docs/index.mdx` landing page,
renamed all doc files from `.md` to `.mdx` with frontmatter and updated internal links.
Moved agent reference docs (`AGENTS.md` + skills) to `agent-docs/` so they ship in the npm
package and can be symlinked into user projects directly.
