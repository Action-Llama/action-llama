# @action-llama/pi-remote

Pi extension for remote code execution via Docker containers, SSH hosts, or local OS users.

Provides a **transport abstraction layer** that redirects Pi's built-in tools (bash, read, write, edit, grep, find, ls) through a pluggable transport, enabling a "brain-body" separation where the LLM session runs locally while commands execute on a remote runtime.

## Usage

### As a Pi extension (interactive)

Load the extension to redirect all tool execution to a configured remote:

```bash
pi -e @action-llama/pi-remote --remote dev-container
```

Once loaded, use `/remote` to manage connections:

```
/remote              # show current binding
/remote dev          # switch to remote "dev"
/remote local        # disconnect, run locally
```

### Configuration

Create a `remotes.json` in your project directory:

```json
{
  "defaultRemote": "dev",
  "remotes": {
    "dev": {
      "type": "container",
      "container": "my-dev-container",
      "cwd": "/workspace"
    },
    "box": {
      "type": "ssh",
      "host": "dev.example.com",
      "user": "alice",
      "cwd": "/home/alice/project"
    },
    "sandbox": {
      "type": "host-user",
      "user": "sandbox-user",
      "cwd": "/tmp"
    }
  }
}
```

Discovery order (first found wins):
1. `$CWD/remotes.json`
2. `$CWD/.pi/remotes.json`
3. `~/.pi/remotes.json`

Binding resolution precedence: `--remote` flag > `defaultRemote` in config > `PI_REMOTE` env var.

### Remote types

| Type | Description | Required fields |
|------|-------------|-----------------|
| `container` | Docker container (via `docker exec`) | `container` |
| `ssh` | SSH host | `host` |
| `host-user` | Local OS user (via `sudo -u`) | — (`user` defaults to `pi-agent`) |

### Programmatic usage (headless)

For use in schedulers or agent runners that already have a transport:

```typescript
import { createPiRemoteFactory, DockerExecTransport } from "@action-llama/pi-remote";

const transport = new DockerExecTransport({ container: "my-container", cwd: "/tmp" });
await transport.connect();

// Get Pi tool definitions backed by the transport
const tools = createPiRemoteFactory(transport, "/tmp");
```

### Transport layer only

Import transports directly without the extension:

```typescript
import { SshTransport } from "@action-llama/pi-remote/transport";

const ssh = new SshTransport({ host: "example.com", user: "deploy" });
await ssh.connect();

const result = await ssh.exec("ls -la");
console.log(result.stdout);

await ssh.close();
```

### Subagent inheritance

When bound to a remote, the extension sets `PI_REMOTE=<name>` on the process. Child Pi processes spawned as subagents inherit this env var and automatically bind to the same remote on startup.

## Transport interface

All transports implement:

```typescript
interface Transport {
  connect(): Promise<void>;
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  readFiles(paths: string[]): Promise<Map<string, Buffer>>;
  writeFiles(files: Map<string, Buffer>): Promise<void>;
  close(): Promise<void>;
}
```

## Development

```bash
# Build
npm run build

# Run tests
npm test

# Clean build artifacts
npm run clean
```

From the monorepo root:

```bash
npm run build          # builds all packages (pi-remote included)
npm run test:unit      # runs all unit tests including pi-remote
```

Build order: `skill` -> `pi-remote` -> `frontend` -> `action-llama`.
