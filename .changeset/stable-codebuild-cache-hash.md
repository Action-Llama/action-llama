---
"@action-llama/action-llama": patch
---

Fixed CodeBuild image cache hash instability caused by temp Dockerfile filenames
containing random UUIDs. The hash now uses a stable "Dockerfile" key instead of
the temp filename, so identical build contexts produce cache hits as expected.
