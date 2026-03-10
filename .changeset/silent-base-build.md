---
"@action-llama/action-llama": patch
---

Log base image build progress in headless mode. Previously there was no output
between "scheduler started" and the first agent build, which could be several
minutes of silence when the base image needed to be built or cached.
