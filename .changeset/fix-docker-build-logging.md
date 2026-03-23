---
"@action-llama/action-llama": patch
---

Fix Docker image build failure detection in E2E tests. Added proper error logging and verification of required build artifacts before building Docker images. This prevents silent failures when build dependencies are missing and provides clear error messages when Docker builds fail. Closes #307.