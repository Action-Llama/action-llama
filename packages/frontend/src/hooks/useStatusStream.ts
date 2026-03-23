import { useEffect, useRef, useState } from "react";
import type {
  AgentStatus,
  SchedulerInfo,
  LogLine,
  AgentInstance,
} from "../lib/api";

interface StatusStreamData {
  agents: AgentStatus[];
  schedulerInfo: SchedulerInfo | null;
  recentLogs: LogLine[];
  instances: AgentInstance[];
}

export function useStatusStream() {
  const [data, setData] = useState<StatusStreamData>({
    agents: [],
    schedulerInfo: null,
    recentLogs: [],
    instances: [],
  });
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/dashboard/api/status-stream");
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        setData((prev) => ({
          agents: parsed.agents ?? prev.agents,
          schedulerInfo: parsed.schedulerInfo ?? prev.schedulerInfo,
          recentLogs: parsed.recentLogs ?? prev.recentLogs,
          instances: parsed.instances ?? prev.instances,
        }));
      } catch {
        // Ignore parse errors
      }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  return { ...data, connected };
}
