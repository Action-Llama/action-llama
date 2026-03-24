---
"@action-llama/action-llama": minor
---

Add bidirectional real-time chat with agents via WebSocket. Users can now chat with agents through the web dashboard (`/chat/:agent`) or remotely via `al chat <agent> --env <name>`. The implementation includes a ChatTransport abstraction (local and remote), a gateway WebSocket bridge that relays messages between browsers and agent containers, a new chat container entrypoint (`AL_CHAT_MODE=1`), session management with configurable limits (`gateway.maxChatSessions`), idle timeout cleanup (15min), and rate limiting. Adds 107 tests across 8 test files covering the full chat stack.
