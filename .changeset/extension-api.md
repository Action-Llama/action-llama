---
"@action-llama/action-llama": minor
---

Added stable extension API for providers. This major refactoring promotes the existing provider patterns into a consistent extension system with central registry, credential requirements, and standardized lifecycle management.

**New Extension Types:**
- **Webhook Extensions**: Handle incoming webhook events (GitHub, Linear, Sentry, Mintlify, Test)
- **Telemetry Extensions**: Send observability data (OpenTelemetry)  
- **Runtime Extensions**: Execute agents in different environments (Local Docker, SSH Docker)
- **Model Extensions**: Provide LLM integration (OpenAI, Anthropic, Custom endpoints)
- **Credential Extensions**: Store and retrieve secrets (File-based, HashiCorp Vault)

**Extension API Features:**
- Declarative credential requirements with validation
- Custom credential type definitions
- Centralized extension registry with type-safe access methods
- Automatic extension loading with graceful error handling
- Comprehensive documentation and examples

**Migration Impact:**
- Replaces hardcoded switch statements in telemetry and runtime factories
- Maintains full backward compatibility with existing configurations
- All built-in providers are automatically converted to extensions
- No user-facing configuration changes required

**Developer Benefits:**
- Eliminates provider-specific conditionals in core codebase
- Enables easy addition of new providers without modifying core
- Provides foundation for future dynamic extension loading
- Standardizes provider interfaces across all types

See `docs/extensions.md` for complete API documentation and examples.

Closes #222.