# @action-llama/pi-remote

Pi extension for remote execution via Docker, SSH, or host-user transports.

## Package overview

This is a private package in the action-llama monorepo. It provides:

1. **Transport layer** — pluggable `Transport` interface with four implementations
2. **Operations adapters** — bridge between Transport and Pi's tool operation interfaces
3. **Pi extension** — interactive extension for `pi -e` with config discovery, `/remote` command, and session lifecycle hooks
4. **Programmatic factory** — headless entry point for action-llama's `TransportAgentRunner`

## Source layout

```
src/
  index.ts              # Main entry, re-exports everything, default export = extension
  extension.ts          # Pi extension factory (interactive mode)
  factory.ts            # createPiRemoteFactory() for headless use
  config.ts             # remotes.json discovery and validation
  binding.ts            # RemoteBinding — mutable session state + transport lifecycle
  command.ts            # /remote command handler
  status.ts             # Status bar text formatting
  transport/
    transport.ts        # Transport interface, ExecResult, ExecOptions, helpers
    docker-exec.ts      # DockerExecTransport — docker exec -i with persistent shell
    ssh.ts              # SshTransport — SSH with persistent shell, ANSI stripping
    host-user.ts        # HostUserTransport — sudo -u with direct filesystem access
    memory.ts           # MemoryTransport — in-memory filesystem for testing
    operations.ts       # Adapters: Transport -> Pi tool operations (all 7 tools)
    index.ts            # Barrel re-exports
```

## Build & test

```bash
npm run build       # tsc -p tsconfig.build.json
npm test            # vitest run
npm run clean       # rm -rf dist
```

Tests are in `test/` mirroring `src/`. Transport tests use mocked `child_process`/`fs` — no Docker or SSH needed.

## Key patterns

### Delimiter-probe pattern

All shell-based transports (Docker, SSH, host-user) spawn a persistent shell process and frame commands with unique delimiter markers (`__AL_DELIM_<hex>__`) to demarcate stdout boundaries and capture exit codes. This avoids per-command process spawning overhead.

### Operations adapters

Pi tools accept custom `operations` objects to override default behavior. The `createTransport*Ops()` factories in `operations.ts` adapt the Transport interface into these operation shapes. `createTransportTools()` assembles all 7 tool definitions at once.

### Two entry points

- **Interactive** (`extension.ts`): Full Pi extension with config discovery, `--remote` flag, `/remote` command, session hooks, status bar. Default export.
- **Headless** (`factory.ts`): `createPiRemoteFactory(transport, cwd)` returns tool definitions only. Used by `TransportAgentRunner` in action-llama.

### Config discovery

`loadRemotesConfig(cwd)` searches three paths (first wins, no merge):
1. `$CWD/remotes.json`
2. `$CWD/.pi/remotes.json`
3. `~/.pi/remotes.json`

### Binding resolution

`RemoteBinding.resolveRemoteName()`: `--remote` flag > config `defaultRemote` > `PI_REMOTE` env var > null.

### Subagent inheritance

The extension sets `PI_REMOTE` env var when bound. Child `pi` processes read this as fallback in `session_start`, inheriting the parent's remote binding automatically.

## Exports

Two export paths in package.json:

- `.` — everything: extension, factory, config, binding, transports, operations
- `./transport` — transport layer only (no Pi dependency at the type level)

## Relationship to action-llama

`packages/action-llama/src/transport/` contains re-export shims that forward to this package. This preserves backward compatibility for internal imports. `TransportAgentRunner` imports directly from `@action-llama/pi-remote`.

## Error types

- `RemoteNotConfiguredError` — no remotes.json found
- `UnknownRemoteError` — name not in config
- `TransportConnectionFailedError` — transport connect() failed
