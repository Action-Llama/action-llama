/**
 * Deterministic agent color generation.
 *
 * Hashes the agent name to a hue (0-360) and returns it.
 * Use with the `.agent-color-bg` and `.agent-color-text` CSS classes
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

/**
 * Returns a hue (0-360) for `name` that is evenly spaced across the color
 * wheel based on its sorted position within `allNames`.
 * Falls back to `agentHue(name)` when `name` is not found or the list is empty.
 */
export function agentHueFromList(name: string, allNames: string[]): number {
  if (allNames.length === 0) return agentHue(name);
  const sorted = [...allNames].sort();
  const index = sorted.indexOf(name);
  if (index === -1) return agentHue(name);
  return (index / sorted.length) * 360;
}

/** Returns inline style object with `--agent-hue` set. */
export function agentHueStyle(name: string, allNames?: string[]): React.CSSProperties {
  const hue =
    allNames && allNames.length > 0
      ? agentHueFromList(name, allNames)
      : agentHue(name);
  return { "--agent-hue": hue } as React.CSSProperties;
}
