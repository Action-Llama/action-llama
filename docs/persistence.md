# Unified Persistence Architecture

Action Llama uses a unified persistence layer that combines key-value storage, event sourcing, and analytics capabilities in a single abstraction. This replaces the previous fragmented approach with separate StateStore, StatsStore, and WorkQueue components.

## Core Concepts

### 1. Key-Value Storage with Namespaces

The KV store provides simple key-value operations with automatic TTL support:

```typescript
import { createPersistenceStore } from "./src/shared/persistence/index.js";

const store = await createPersistenceStore({ type: "sqlite", path: "./data.db" });

// Store data with optional TTL
await store.kv.set("locks", "resource-123", { holder: "agent-1" }, { ttl: 3600 });

// Retrieve data
const lock = await store.kv.get("locks", "resource-123");

// List all keys in a namespace
const allLocks = await store.kv.list("locks");

// Delete single key or entire namespace
await store.kv.delete("locks", "resource-123");
await store.kv.deleteAll("locks");
```

### 2. Event Sourcing

Events provide an append-only audit trail for all system operations:

```typescript
// Get or create an event stream
const statsStream = store.events.stream("stats");

// Append events
await statsStream.append({
  type: "run.started",
  data: { agentName: "my-agent", instanceId: "abc123" },
  metadata: { source: "scheduler", actor: "system" },
  version: 1
});

await statsStream.append({
  type: "run.completed",
  data: { agentName: "my-agent", instanceId: "abc123", durationMs: 5000 },
  metadata: { correlationId: "abc123" },
  version: 1
});

// Replay events with filtering
for await (const event of statsStream.replay({ type: "run.completed", from: Date.now() - 86400000 })) {
  console.log(`Run ${event.data.instanceId} took ${event.data.durationMs}ms`);
}
```

### 3. Snapshots for Performance

Large event streams can be optimized with snapshots:

```typescript
// Save a computed projection as a snapshot
const summary = buildAgentSummary(events);
await statsStream.saveSnapshot("agent-summary", summary, lastEventId);

// Restore from snapshot + replay recent events
const snapshot = await statsStream.getSnapshot("agent-summary");
const recentEvents = statsStream.replay({ from: snapshot.timestamp });
```

### 4. Transactions

Atomic operations across KV and event operations:

```typescript
await store.transaction(async (txStore) => {
  // Both operations succeed or both fail
  await txStore.kv.set("sessions", sessionId, sessionData);
  await txStore.events.stream("audit").append({
    type: "session.created",
    data: { sessionId, userId },
    version: 1
  });
});
```

### 5. SQL Queries for Analytics

Direct SQL access for complex analytics (backend-dependent):

```typescript
const results = await store.query.sql(`
  SELECT agent_name, COUNT(*) as run_count 
  FROM events 
  WHERE type = 'run.completed' 
    AND timestamp > ? 
  GROUP BY agent_name
`, [Date.now() - 86400000]);
```

## Backends

### SQLite Backend

The default backend for local deployments:

```typescript
const store = await createPersistenceStore({
  type: "sqlite",
  path: "./action-llama.db" // or ":memory:" for testing
});
```

Features:
- Single file database with WAL mode for concurrency
- Automatic TTL cleanup via periodic sweeps  
- Optimized indexes for common query patterns
- Transaction support with ACID guarantees
- Schema designed for event sourcing and KV operations

### Memory Backend

For testing and development:

```typescript
const store = await createPersistenceStore({
  type: "memory",
  maxSize: 10000 // Optional size limit
});
```

Features:
- In-memory storage with no persistence
- Transaction support via state snapshots
- Size limits to prevent memory leaks
- Same interface as SQLite backend

## Migration from Legacy Stores

### Automatic Migration

The system includes migration utilities to transition from the old fragmented stores:

```typescript
import { migrateFromLegacy } from "./src/shared/persistence/migration.js";
import { createStateStore } from "./src/shared/state-store.js";
import { StatsStore } from "./src/stats/store.js";

const newStore = await createPersistenceStore({ type: "sqlite", path: "./unified.db" });
const oldStateStore = await createStateStore({ type: "sqlite", path: "./old-state.db" });
const oldStatsStore = new StatsStore("./old-stats.db");

await migrateFromLegacy(newStore, oldStateStore, oldStatsStore);
```

### Backward Compatibility Adapters

Existing code continues to work during migration via adapter classes:

```typescript
import { StateStoreAdapter } from "./src/shared/persistence/adapters/state-store.js";
import { StatsStoreAdapter } from "./src/shared/persistence/adapters/stats-store.js";

// Use new persistence with old interface
const stateStore = new StateStoreAdapter(unifiedStore);
const statsStore = new StatsStoreAdapter(unifiedStore);

// Existing code works unchanged
await stateStore.set("locks", "key", value);
statsStore.recordRun(runData);
```

## Event Types and Schema

### Standard Event Types

The system defines standard event types in `EventTypes`:

```typescript
import { EventTypes } from "./src/shared/persistence/event-store.js";

// Run lifecycle
EventTypes.RUN_STARTED    // "run.started"
EventTypes.RUN_COMPLETED  // "run.completed" 
EventTypes.RUN_FAILED     // "run.failed"

// Call lifecycle
EventTypes.CALL_INITIATED // "call.initiated"
EventTypes.CALL_COMPLETED // "call.completed"
EventTypes.CALL_FAILED    // "call.failed"

// Work queue
EventTypes.WORK_QUEUED    // "work.queued"
EventTypes.WORK_DEQUEUED  // "work.dequeued"
EventTypes.WORK_DROPPED   // "work.dropped"

// Resource management
EventTypes.LOCK_ACQUIRED  // "lock.acquired"
EventTypes.LOCK_RELEASED  // "lock.released"
EventTypes.LOCK_EXPIRED   // "lock.expired"

EventTypes.SESSION_CREATED // "session.created"
EventTypes.SESSION_EXPIRED // "session.expired"
```

### Event Schema Evolution

Events include version numbers for schema evolution:

```typescript
// Register a migration
const migrator = new EventMigrator();
migrator.addMigration("run.completed", {
  fromVersion: 1,
  toVersion: 2,
  migrate: (event) => ({
    ...event,
    version: 2,
    data: {
      ...event.data,
      newField: "default-value"
    }
  })
});

// Automatically migrate on replay
const migratedEvent = migrator.migrate(oldEvent, 2);
```

## Best Practices

### 1. Use Appropriate Storage Pattern

- **KV storage**: Session data, configuration, temporary state
- **Event sourcing**: Audit trails, analytics, state changes
- **SQL queries**: Complex analytics, reporting

### 2. Design Events for Replay

Events should be self-contained and idempotent:

```typescript
// Good: Complete context in event
{
  type: "run.completed",
  data: {
    instanceId: "abc123",
    agentName: "my-agent", 
    result: "success",
    durationMs: 5000
  }
}

// Avoid: Relative or incomplete data
{
  type: "run.completed", 
  data: { status: "done" } // Missing context
}
```

### 3. Use Metadata for Filtering

Leverage metadata for cross-cutting concerns:

```typescript
await stream.append({
  type: "deployment.started",
  data: { service: "api", version: "1.2.3" },
  metadata: {
    source: "deployment-service",
    environment: "production",
    correlationId: deploymentId,
    actor: "deploy-bot"
  }
});
```

### 4. Optimize with Snapshots

For event streams with thousands of events:

```typescript
// Periodic snapshot creation
setInterval(async () => {
  const projection = await buildProjection();
  await stream.saveSnapshot("hourly-stats", projection, lastEventId);
}, 3600000); // Every hour

// Fast query using snapshot + recent events
const snapshot = await stream.getSnapshot("hourly-stats");
const recent = stream.replay({ from: snapshot.timestamp });
const current = applyEvents(snapshot.data, recent);
```

### 5. Handle Eventual Consistency

Event sourcing is eventually consistent. Design for it:

```typescript
// Good: Query the event stream for authoritative data
const events = await statsStream.replay({ type: "run.completed" });
const runCount = events.length;

// Risky: Relying on cached projections for critical decisions
const cached = await getCache("run-count"); // May be stale
```

## Performance Considerations

### SQLite Optimizations

- Uses WAL mode for better concurrency
- Optimized indexes for common access patterns
- Periodic cleanup of expired KV entries
- Prepared statements for frequent operations

### Memory Usage

- Event streams can grow large - use snapshots for long-running streams
- KV store TTL helps prevent unbounded growth
- Memory backend has configurable size limits

### Query Patterns

```typescript
// Efficient: Use indexes
stream.replay({ type: "run.completed" })  // Uses type index
stream.replay({ from: timestamp })        // Uses timestamp index

// Less efficient: Complex filters
for await (const event of stream.replay()) {
  if (event.data.agentName === "specific-agent") { /* ... */ }
}

// Better: Multiple streams
const agentStream = store.events.stream(`agent-${agentName}`);
```

## Future Extensions

The unified persistence architecture is designed for future enhancements:

- **Additional backends**: PostgreSQL, DynamoDB for cloud deployments
- **Replication**: Event log replication for high availability  
- **Real-time subscriptions**: WebSocket streams from event logs
- **Schema registry**: Centralized event schema management
- **CQRS**: Read models optimized for specific query patterns

## Implementation Status

- ✅ Core persistence interface and SQLite backend
- ✅ Memory backend for testing
- ✅ Event sourcing with snapshots
- ✅ Migration utilities from legacy stores
- ✅ Backward compatibility adapters
- ✅ Basic test suite
- 🔄 Gradual rollout to replace legacy stores
- ⏳ Documentation and examples
- ⏳ Performance optimization and monitoring