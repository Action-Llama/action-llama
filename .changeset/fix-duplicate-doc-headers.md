---
"@action-llama/action-llama": patch
---

Fixed duplicate page headers across all docs pages. Mintlify renders the
frontmatter `title` as the page header automatically, but every MDX file also
had an explicit `# H1` causing the title to appear twice. Also fixed `cloud.mdx`
frontmatter title which was incorrectly set to "VPS Deployment".
