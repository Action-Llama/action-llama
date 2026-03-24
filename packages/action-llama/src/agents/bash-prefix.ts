/**
 * Bash command prefix injected before every agent shell command.
 *
 * Defines `setenv NAME value` — a convenience function that persists an
 * environment variable across bash calls.  Each call spawns a fresh shell,
 * so we re-define the function and re-source /tmp/env.sh every time.
 */
export const BASH_COMMAND_PREFIX = [
  // Define setenv — persists the variable AND exports it in the current shell.
  // printf %q escapes special characters so the written line is always safe to source.
  "setenv() { printf 'export %s=%q\\n' \"$1\" \"$2\" >> /tmp/env.sh; export \"$1\"=\"$2\"; }",
  // Source previously-set variables (if any).
  "[ -f /tmp/env.sh ] && source /tmp/env.sh",
].join("; ");
