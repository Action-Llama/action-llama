---
"@action-llama/action-llama": minor
---

Unify persistence story with event sourcing and unified storage layer

Replaces the fragmented StateStore/StatsStore/WorkQueue pattern with a single unified persistence layer that combines key-value storage, event sourcing, and analytics capabilities. This architectural change enables features like replay, audit trails, and high availability without requiring parallel storage logic.

**Key features:**
- **Unified interface**: Single `PersistenceStore` combining KV operations, event sourcing, and queries
- **Event sourcing**: Append-only event streams with replay capabilities for audit and analytics
- **Multiple backends**: SQLite (default) and memory backends, designed for future cloud backends
- **Backward compatibility**: Adapters for existing StateStore/StatsStore interfaces
- **Migration utilities**: Automated migration from legacy stores with progress reporting
- **Transaction support**: Atomic operations across KV and event operations
- **Snapshots**: Performance optimization for large event streams

**Architecture benefits:**
- Natural audit trail for all system operations
- Replay capabilities for debugging and analytics  
- Event-driven architecture foundation for real-time features
- Consistent storage patterns across all components
- Simplified deployment with single database file
- Future-ready for distributed deployments

**Migration path:**
- Existing code continues working via compatibility adapters
- Automatic migration utilities preserve all historical data
- Gradual rollout allows incremental adoption
- No breaking changes to public APIs

The unified persistence layer provides a solid foundation for advanced features like real-time dashboards, distributed deployments, and comprehensive audit logging while maintaining the simplicity of Action Llama's single-file SQLite approach for local development.