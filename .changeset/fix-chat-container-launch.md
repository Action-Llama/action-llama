---
"@action-llama/action-llama": patch
---

Fix chat not connecting to agent container. The gateway starts before
Docker images are built, so the chat container launcher was never wired
up — clicking Chat or running `al chat <agent> --env` silently did
nothing. The launcher is now connected after image builds complete via
a late-binding `setChatRuntime` callback.
