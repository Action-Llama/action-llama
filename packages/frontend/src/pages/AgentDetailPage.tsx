import { useParams, Link } from "react-router-dom";
import { useAgents } from "../hooks/StatusStreamContext";
import { useQuery } from "../hooks/useQuery";
import { ActivityTable } from "../components/ActivityTable";
import { getActivity } from "../lib/api";
import type { ActivityRow } from "../lib/api";

export function AgentDetailPage() {
  const { name } = useParams<{ name: string }>();
  const agents = useAgents();

  const agent = agents.find((a) => a.name === name) ?? null;
  const agentNames = agents.map((a) => a.name);

  const { data: activityData } = useQuery<{ rows: ActivityRow[]; total: number }>({
    key: `agent-activity:${name}`,
    fetcher: (signal) => getActivity(5, 0, name!, undefined, undefined, signal),
    invalidateOn: ["runs"],
    invalidateAgent: name,
    enabled: !!name,
  });
  const activity = activityData?.rows ?? [];

  if (!name) return null;

  return (
    <div className="space-y-6">
      {/* Activity */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-slate-900 dark:text-white">Activity</h2>
            {(agent?.queuedWebhooks ?? 0) > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                {agent!.queuedWebhooks} pending
              </span>
            )}
          </div>
          <Link
            to={`/activity?agent=${encodeURIComponent(name)}`}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            View all
          </Link>
        </div>
        <div className="overflow-x-auto">
          <ActivityTable
            rows={activity}
            agentNames={agentNames}
            emptyMessage="No activity yet"
          />
        </div>
      </div>
    </div>
  );
}
