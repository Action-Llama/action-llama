import { Link } from "react-router-dom";
import { useStatusStream } from "../hooks/StatusStreamContext";
import { fmtTokens, fmtSessionTime } from "../lib/format";
import { agentHueStyle } from "../lib/color";

export function StatsPage() {
  const { agents, schedulerInfo } = useStatusStream();
  const agentNames = agents.map((a) => a.name);

  const totalTokens = agents.reduce(
    (sum, a) => sum + (a.cumulativeUsage?.totalTokens ?? 0),
    0,
  );

  const sortedAgents = agents
    .filter((a) => (a.cumulativeUsage?.totalTokens ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.cumulativeUsage?.totalTokens ?? 0) -
        (a.cumulativeUsage?.totalTokens ?? 0),
    );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          Stats
        </h1>
      </div>

      {/* Subnav */}
      <div className="flex items-center gap-2">
        <span className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white">
          Token Usage
        </span>
      </div>

      {/* Session time range */}
      {schedulerInfo?.startedAt && (
        <div className="text-sm text-slate-500 dark:text-slate-400">
          Session: {fmtSessionTime(schedulerInfo.startedAt)}
        </div>
      )}

      {/* Agent usage list */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
        {totalTokens === 0 ? (
          <div className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
            No token usage recorded yet
          </div>
        ) : (
          sortedAgents.map((agent) => {
            const tokens = agent.cumulativeUsage?.totalTokens ?? 0;
            const pct = (tokens / totalTokens) * 100;
            return (
              <div
                key={agent.name}
                className="px-4 py-3 border-b border-slate-100 dark:border-slate-800/50 last:border-0"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <Link
                    to={`/dashboard/agents/${encodeURIComponent(agent.name)}`}
                    className="agent-color-text text-sm font-medium hover:underline"
                    style={agentHueStyle(agent.name, agentNames)}
                  >
                    {agent.name}
                  </Link>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {fmtTokens(tokens)} ({pct.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full agent-color-bg transition-all"
                    style={{
                      width: `${pct}%`,
                      ...agentHueStyle(agent.name, agentNames),
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
