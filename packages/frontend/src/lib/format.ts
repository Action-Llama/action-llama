export function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function fmtTime(iso: string | null): string {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleTimeString();
}

export function fmtCost(usd: number): string {
  if (!usd || usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function fmtTokens(n: number): string {
  if (!n || n === 0) return "0";
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function shortId(id: string): string {
  if (id.length <= 9) return id;
  return `${id.slice(0, 4)}\u2026${id.slice(-4)}`;
}

export function shortName(name: string, max = 11): string {
  if (name.length <= max) return name;
  const half = Math.floor((max - 1) / 2);
  return `${name.slice(0, half)}\u2026${name.slice(-half)}`;
}

export function fmtDateTime(ts: number | string): string {
  return new Date(ts).toLocaleString();
}

export function fmtSessionTime(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return "";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) {
    const mins = Math.floor(ms / 60_000);
    return `last ${mins}m`;
  }
  if (hours < 24) return `last ${hours}h`;
  const days = Math.floor(hours / 24);
  return `last ${days}d`;
}

export function fmtRelativeTime(ts: number | string): string {
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 0) return new Date(ts).toLocaleString();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ts).toLocaleString();
}
