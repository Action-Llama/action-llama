import { resolve } from "path";
import { existsSync } from "fs";
import { statsDbPath } from "../../shared/paths.js";

function parseSince(since: string): number {
  const match = since.match(/^(\d+)(h|d)$/);
  if (!match) throw new Error(`Invalid --since value: ${since}. Use e.g. 24h, 7d, 30d`);
  const [, n, unit] = match;
  const ms = unit === "h" ? Number(n) * 3600_000 : Number(n) * 86400_000;
  return Date.now() - ms;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m${rem}s` : `${m}m`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

export async function execute(opts: {
  project: string;
  agent?: string;
  since: string;
  n: number;
  json?: boolean;
  calls?: boolean;
}): Promise<void> {
  const projectPath = resolve(opts.project);
  const dbPath = statsDbPath(projectPath);

  if (!existsSync(dbPath)) {
    console.log("No stats data yet. Run some agents first.");
    return;
  }

  const { StatsStore } = await import("../../stats/index.js");
  const store = new StatsStore(dbPath);

  try {
    const since = parseSince(opts.since);

    // --calls mode: show call graph summary
    if (opts.calls) {
      const edges = store.queryCallGraph({ since });

      if (opts.json) {
        console.log(JSON.stringify(edges, null, 2));
        return;
      }

      if (edges.length === 0) {
        console.log(`No call edges in the last ${opts.since}.`);
        return;
      }

      const cols = { caller: 16, target: 16, count: 8, depth: 12, duration: 14 };
      console.log(
        "CALLER".padEnd(cols.caller) +
        "TARGET".padEnd(cols.target) +
        "COUNT".padEnd(cols.count) +
        "AVG DEPTH".padEnd(cols.depth) +
        "AVG DURATION"
      );
      console.log("-".repeat(cols.caller + cols.target + cols.count + cols.depth + cols.duration));

      for (const edge of edges) {
        console.log(
          String(edge.callerAgent).padEnd(cols.caller) +
          String(edge.targetAgent).padEnd(cols.target) +
          String(edge.count).padEnd(cols.count) +
          String(Math.round(edge.avgDepth ?? 0)).padEnd(cols.depth) +
          (edge.avgDurationMs != null ? formatDuration(edge.avgDurationMs) : "\u2014")
        );
      }
      return;
    }

    // Per-agent detail view
    if (opts.agent) {
      const summaries = store.queryAgentSummary({ agent: opts.agent, since });
      const runs = store.queryRuns({ agent: opts.agent, since, limit: opts.n });

      if (opts.json) {
        console.log(JSON.stringify({ summary: summaries[0] || null, runs }, null, 2));
        return;
      }

      if (summaries.length === 0) {
        console.log(`No runs for "${opts.agent}" in the last ${opts.since}.`);
        return;
      }

      const s = summaries[0];
      console.log(`${opts.agent} (last ${opts.since}): ${s.totalRuns} runs (${s.okRuns} ok, ${s.errorRuns} err) | ${formatTokens(s.totalTokens)} tokens | ${formatCost(s.totalCost)}\n`);

      if (runs.length > 0) {
        const cols = { instance: 20, trigger: 12, result: 12, duration: 12, tokens: 10, cost: 10, started: 20 };
        console.log(
          "INSTANCE".padEnd(cols.instance) +
          "TRIGGER".padEnd(cols.trigger) +
          "RESULT".padEnd(cols.result) +
          "DURATION".padEnd(cols.duration) +
          "TOKENS".padEnd(cols.tokens) +
          "COST".padEnd(cols.cost) +
          "STARTED"
        );
        console.log("-".repeat(cols.instance + cols.trigger + cols.result + cols.duration + cols.tokens + cols.cost + cols.started));

        for (const run of runs) {
          const instanceShort = run.instance_id.length > 18 ? `...${run.instance_id.slice(-15)}` : run.instance_id;
          const started = new Date(run.started_at).toISOString().slice(0, 19).replace("T", " ");
          console.log(
            instanceShort.padEnd(cols.instance) +
            run.trigger_type.padEnd(cols.trigger) +
            run.result.padEnd(cols.result) +
            formatDuration(run.duration_ms).padEnd(cols.duration) +
            formatTokens(run.total_tokens).padEnd(cols.tokens) +
            formatCost(run.cost_usd).padEnd(cols.cost) +
            started
          );
        }
      }
      return;
    }

    // Global summary view
    const global = store.queryGlobalSummary(since);
    const summaries = store.queryAgentSummary({ since });

    if (opts.json) {
      console.log(JSON.stringify({ global, agents: summaries }, null, 2));
      return;
    }

    if (global.totalRuns === 0) {
      console.log(`No runs in the last ${opts.since}.`);
      return;
    }

    console.log(`Totals (last ${opts.since}): ${global.totalRuns} runs (${global.okRuns} ok, ${global.errorRuns} err) | ${formatTokens(global.totalTokens)} tokens | ${formatCost(global.totalCost)}\n`);

    if (summaries.length > 0) {
      const cols = { agent: 16, runs: 8, ok: 6, err: 6, dur: 10, tokens: 10, cost: 10, pre: 10, post: 10 };
      console.log(
        "AGENT".padEnd(cols.agent) +
        "RUNS".padEnd(cols.runs) +
        "OK".padEnd(cols.ok) +
        "ERR".padEnd(cols.err) +
        "AVG DUR".padEnd(cols.dur) +
        "TOKENS".padEnd(cols.tokens) +
        "COST".padEnd(cols.cost) +
        "AVG PRE".padEnd(cols.pre) +
        "AVG POST"
      );
      console.log("-".repeat(cols.agent + cols.runs + cols.ok + cols.err + cols.dur + cols.tokens + cols.cost + cols.pre + cols.post));

      for (const s of summaries) {
        console.log(
          String(s.agentName).padEnd(cols.agent) +
          String(s.totalRuns).padEnd(cols.runs) +
          String(s.okRuns).padEnd(cols.ok) +
          String(s.errorRuns).padEnd(cols.err) +
          formatDuration(s.avgDurationMs).padEnd(cols.dur) +
          formatTokens(s.totalTokens).padEnd(cols.tokens) +
          formatCost(s.totalCost).padEnd(cols.cost) +
          (s.avgPreHookMs != null ? formatDuration(s.avgPreHookMs) : "\u2014").padEnd(cols.pre) +
          (s.avgPostHookMs != null ? formatDuration(s.avgPostHookMs) : "\u2014")
        );
      }
    }
  } finally {
    store.close();
  }
}
