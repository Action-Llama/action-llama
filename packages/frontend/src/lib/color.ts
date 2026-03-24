/**
 * Deterministic agent color generation.
 *
 * Hashes the agent name to a hue (0-360) and returns it.
 * Use with the `.agent-color-bg` and `.agent-color-dot` CSS classes
 * by setting `--agent-hue` as an inline style.
 */

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Returns a stable hue (0-360) derived from the agent name. */
export function agentHue(name: string): number {
  return hashString(name) % 360;
}

/** Returns inline style object with `--agent-hue` set. */
export function agentHueStyle(name: string): React.CSSProperties {
  return { "--agent-hue": agentHue(name) } as React.CSSProperties;
}
