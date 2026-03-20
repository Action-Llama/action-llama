---
"@action-llama/action-llama": patch
---

Improve `al doctor` webhook validation: validate that webhook source types are known providers (catches typos like "githib"), warn when non-test webhook sources have no credential configured (accepts unsigned webhooks), and fix missing Linear/Mintlify entries in credential collection so their webhook secrets are properly checked.
