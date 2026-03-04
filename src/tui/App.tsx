import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { StatusTracker, AgentStatus, SchedulerInfo, LogLine } from "./status-tracker.js";

function formatRelativeTime(date: Date | null): string {
  if (!date) return "";
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${min}m${remSec > 0 ? remSec + "s" : ""}`;
}

function formatTimeUntil(date: Date | null): string {
  if (!date) return "";
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return "now";
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  return `${diffMin}m`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour12: false });
}

function Header({ info, agentCount }: { info: SchedulerInfo | null; agentCount: number }) {
  if (!info) return null;
  const modeLabel = info.mode === "docker" ? "Docker mode" : "Host mode";
  return (
    <Box flexDirection="column">
      <Text bold>
        Action Llama ({modeLabel}) — {agentCount} agent{agentCount !== 1 ? "s" : ""}, {info.cronJobCount} cron job{info.cronJobCount !== 1 ? "s" : ""}
      </Text>
      <Text dimColor>
        {info.gatewayPort ? `Gateway: :${info.gatewayPort}` : ""}
        {info.gatewayPort && info.webhooksActive ? " | " : ""}
        {info.webhooksActive ? "Webhooks: active" : ""}
      </Text>
      {info.webhookUrls.map((url, i) => (
        <Text key={i} dimColor>  {url}</Text>
      ))}
      <Text dimColor>{"─".repeat(50)}</Text>
    </Box>
  );
}

function AgentRow({ agent }: { agent: AgentStatus }) {
  const stateColor = agent.state === "running" ? "green" : "white";
  const stateLabel = agent.state === "running" ? "Running" : "Idle";

  return (
    <Box>
      <Box width={12}>
        <Text bold>{agent.name}</Text>
      </Box>
      <Box width={10}>
        <Text color={stateColor}>{stateLabel}</Text>
      </Box>
      <Box width={30}>
        <Text dimColor>
          {agent.statusText ? `"${agent.statusText}"` : ""}
        </Text>
      </Box>
      <Box width={20}>
        <Text dimColor>
          {agent.lastRunAt
            ? `Last: ${formatRelativeTime(agent.lastRunAt)}${agent.lastRunDuration !== null ? ` (${formatDuration(agent.lastRunDuration)})` : ""}`
            : ""}
        </Text>
      </Box>
      <Box>
        <Text dimColor>
          {agent.nextRunAt ? `Next: ${formatTimeUntil(agent.nextRunAt)}` : ""}
        </Text>
      </Box>
    </Box>
  );
}

function RecentActivity({ logs }: { logs: LogLine[] }) {
  if (logs.length === 0) return null;
  return (
    <Box flexDirection="column">
      <Text dimColor>{"─".repeat(50)}</Text>
      <Text bold>Recent:</Text>
      {logs.map((log, i) => (
        <Text key={i} dimColor>
          {"  "}{formatTime(log.timestamp)} [{log.agent}] {log.message.slice(0, 80)}
        </Text>
      ))}
    </Box>
  );
}

function Footer() {
  return (
    <Box flexDirection="column">
      <Text dimColor>{"─".repeat(50)}</Text>
      <Text dimColor>Ctrl+C to stop</Text>
    </Box>
  );
}

export default function App({ statusTracker }: { statusTracker: StatusTracker }) {
  const [agents, setAgents] = useState<AgentStatus[]>(() => statusTracker.getAllAgents());
  const [info, setInfo] = useState<SchedulerInfo | null>(() => statusTracker.getSchedulerInfo());
  const [logs, setLogs] = useState<LogLine[]>(() => statusTracker.getRecentLogs(5));
  const [, setTick] = useState(0);

  useEffect(() => {
    const update = () => {
      setAgents(statusTracker.getAllAgents());
      setInfo(statusTracker.getSchedulerInfo());
      setLogs(statusTracker.getRecentLogs(5));
    };

    statusTracker.on("update", update);
    update(); // initial render

    // 1-second timer for relative time updates
    const timer = setInterval(() => setTick((t) => t + 1), 1000);

    return () => {
      statusTracker.off("update", update);
      clearInterval(timer);
    };
  }, [statusTracker]);

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Header info={info} agentCount={agents.length} />
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        {agents.map((agent) => (
          <AgentRow key={agent.name} agent={agent} />
        ))}
      </Box>
      <RecentActivity logs={logs} />
      <Footer />
    </Box>
  );
}
