/**
 * File-based signal IPC for agent communication.
 *
 * Shell commands (al-rerun, al-status, al-return, al-exit) write
 * signal files to $AL_SIGNAL_DIR. Runners read them after the session ends
 * via readSignals(). In container mode, commands also POST to $GATEWAY_URL
 * for real-time TUI updates.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

export interface AgentSignals {
  rerun: boolean;
  status?: string;
  returnValue?: string;
  exitCode?: number;
}

/**
 * Ensure the signal directory exists and clean any stale signal files.
 * Scripts are baked into the image at /app/bin/ — this only creates the
 * per-run signal directory.
 */
export function ensureSignalDir(signalDir: string): void {
  mkdirSync(signalDir, { recursive: true });
}

/**
 * Install signal shell commands into a bin directory.
 * The bin dir should be prepended to PATH so agents can use these commands.
 *
 * In container mode, scripts are baked into the image at /app/bin/ and this
 * function is not called. It remains for host-mode agent runners.
 */
export function installSignalCommands(binDir: string, signalDir: string): void {
  mkdirSync(binDir, { recursive: true });
  mkdirSync(signalDir, { recursive: true });

  // al-rerun — request an immediate rerun
  const alRerun = `#!/bin/sh
touch "$AL_SIGNAL_DIR/rerun"
if [ -n "$GATEWAY_URL" ] && [ -n "$SHUTDOWN_SECRET" ]; then
  curl -s -X POST "$GATEWAY_URL/signals/rerun" \\
    -H 'Content-Type: application/json' \\
    -d '{"secret":"'"$SHUTDOWN_SECRET"'"}' > /dev/null 2>&1 || true
fi
echo '{"ok":true}'
`;

  // al-status — update status text
  const alStatus = `#!/bin/sh
if [ -z "$1" ]; then echo '{"ok":false,"error":"usage: al-status \\"<text>\\""}'; exit 1; fi
printf '%s' "$1" > "$AL_SIGNAL_DIR/status"
if [ -n "$GATEWAY_URL" ] && [ -n "$SHUTDOWN_SECRET" ]; then
  curl -s -X POST "$GATEWAY_URL/signals/status" \\
    -H 'Content-Type: application/json' \\
    -d "$(printf '{"secret":"%s","text":"%s"}' "$SHUTDOWN_SECRET" "$1")" > /dev/null 2>&1 || true
fi
echo '{"ok":true}'
`;

  // al-return — return a value to the calling agent (arg or stdin)
  const alReturn = `#!/bin/sh
if [ $# -gt 0 ]; then
  VALUE="$*"
else
  VALUE=$(cat)
fi
printf '%s' "$VALUE" > "$AL_SIGNAL_DIR/return"
if [ -n "$GATEWAY_URL" ] && [ -n "$SHUTDOWN_SECRET" ]; then
  PAYLOAD=$(printf '{"secret":"%s","value":%s}' "$SHUTDOWN_SECRET" "$(printf '%s' "$VALUE" | jq -Rs .)")
  curl -s -X POST "$GATEWAY_URL/signals/return" \\
    -H 'Content-Type: application/json' \\
    -d "$PAYLOAD" > /dev/null 2>&1 || true
fi
echo '{"ok":true}'
`;

  // al-exit — terminate with an exit code
  // Uses string concatenation to avoid template literal ${} conflicts
  const alExit = [
    "#!/bin/sh",
    'CODE="${1:-15}"',
    "printf '%s' \"$CODE\" > \"$AL_SIGNAL_DIR/exit\"",
    "echo '{\"ok\":true}'",
    "",
  ].join("\n");

  writeFileSync(join(binDir, "al-rerun"), alRerun, { mode: 0o755 });
  writeFileSync(join(binDir, "al-status"), alStatus, { mode: 0o755 });
  writeFileSync(join(binDir, "al-return"), alReturn, { mode: 0o755 });
  writeFileSync(join(binDir, "al-exit"), alExit, { mode: 0o755 });
}

/**
 * Read signal files written by the shell commands.
 * Call this after the agent session ends.
 */
export function readSignals(signalDir: string): AgentSignals {
  const signals: AgentSignals = {
    rerun: false,
  };

  if (!existsSync(signalDir)) {
    return signals;
  }

  // rerun
  if (existsSync(join(signalDir, "rerun"))) {
    signals.rerun = true;
  }

  // status
  const statusPath = join(signalDir, "status");
  if (existsSync(statusPath)) {
    signals.status = readFileSync(statusPath, "utf-8").trim();
  }

  // return value
  const returnPath = join(signalDir, "return");
  if (existsSync(returnPath)) {
    signals.returnValue = readFileSync(returnPath, "utf-8").trim();
  }

  // exit code
  const exitPath = join(signalDir, "exit");
  if (existsSync(exitPath)) {
    const raw = readFileSync(exitPath, "utf-8").trim();
    const code = parseInt(raw, 10);
    if (!isNaN(code)) {
      signals.exitCode = code;
    }
  }

  return signals;
}
