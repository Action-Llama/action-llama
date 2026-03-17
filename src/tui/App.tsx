import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
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

function Header({ info, agentCount, agents }: { info: SchedulerInfo | null; agentCount: number; agents: AgentStatus[] }) {
  if (!info) return null;
  const modeLabel = info.mode === "host" ? "Host mode" : "Docker mode";

  const enabledCount = agents.filter(a => a.enabled).length;
  const disabledCount = agentCount - enabledCount;

  return (
    <Box flexDirection="column">
      <Text bold>
        Action Llama{info.projectName ? ` — ${info.projectName}` : ""} ({modeLabel}) — {agentCount} agent{agentCount !== 1 ? "s" : ""}
        ({enabledCount} enabled{disabledCount > 0 ? `, ${disabledCount} disabled` : ""}), {info.cronJobCount} cron job{info.cronJobCount !== 1 ? "s" : ""}
      </Text>
      <Text dimColor>
        {info.gatewayPort ? `Gateway: :${info.gatewayPort}` : ""}
        {info.gatewayPort && info.webhooksActive ? " | " : ""}
        {info.webhooksActive ? "Webhooks: active" : ""}
      </Text>
      {info.webhookUrls.map((url, i) => (
        <Text key={i} dimColor>  {url}</Text>
      ))}
      {info.dashboardUrl ? (
        <Text dimColor>Dashboard: {info.dashboardUrl}</Text>
      ) : null}
      <Text dimColor>{"─".repeat(50)}</Text>
    </Box>
  );
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function InitializingView({ info, agents, baseImageStatus, tick }: { info: SchedulerInfo | null; agents: AgentStatus[]; baseImageStatus: string | null; tick: number }) {
  const spinnerFrame = SPINNER_FRAMES[tick % SPINNER_FRAMES.length];

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold>
        Action Llama{info?.projectName ? ` — ${info.projectName}` : ""} — Initializing
      </Text>
      <Text dimColor>{"─".repeat(50)}</Text>
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        {baseImageStatus ? (
          <Box>
            <Text color="yellow">{spinnerFrame} Base image: {baseImageStatus}</Text>
          </Box>
        ) : null}
        {agents.map((agent) => {
          const isBuilding = agent.state === "building";
          const isDone = !isBuilding && !baseImageStatus;
          const icon = isDone ? "✓" : isBuilding ? spinnerFrame : "○";
          const color = isDone ? "green" : isBuilding ? "yellow" : "white";
          const detail = agent.statusText || (isBuilding ? "Waiting to build" : isDone ? "Ready" : "Waiting");
          return (
            <Box key={agent.name} flexDirection="column">
              <Box>
                <Box width={4}>
                  <Text color={color}>{icon} </Text>
                </Box>
                <Box width={14}>
                  <Text bold>{agent.name}</Text>
                </Box>
                <Text color={color} dimColor={!isBuilding && !isDone}>{detail}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>
      <Text dimColor>{"─".repeat(50)}</Text>
      <Text dimColor>Building Docker images... Ctrl+C to cancel</Text>
    </Box>
  );
}

function AgentRow({ agent, isSelected }: { agent: AgentStatus; isSelected: boolean }) {
  const stateColor = agent.state === "running" ? "green" : agent.state === "building" ? "yellow" : agent.state === "error" ? "red" : "white";
  const stateLabel = agent.state === "running"
    ? agent.scale > 1 ? `Running ${agent.runningCount}/${agent.scale}` : "Running"
    : agent.state === "building" ? "Building"
    : agent.state === "error" ? "Error"
    : agent.scale > 1 ? `Idle (×${agent.scale})` : "Idle";

  // Show status text, or last error for error state
  const detail = agent.statusText
    ? `"${agent.statusText}"`
    : agent.state === "error" && agent.lastError
      ? agent.lastError
      : "";

  const enabledLabel = agent.enabled ? "Enabled" : "Disabled";
  const enabledColor = agent.enabled ? "green" : "yellow";

  return (
    <Box flexDirection="column">
      <Box backgroundColor={isSelected ? "blue" : undefined}>
        <Box width={12}>
          <Text bold color={isSelected ? "white" : undefined}>
            {isSelected ? "▶ " : "  "}{agent.name}
          </Text>
        </Box>
        <Box width={16}>
          <Text color={isSelected ? "white" : stateColor}>{stateLabel}</Text>
        </Box>
        <Box width={10}>
          <Text color={isSelected ? "white" : enabledColor}>{enabledLabel}</Text>
        </Box>
        <Box width={30}>
          <Text dimColor={!isSelected}>
            {agent.lastRunAt
              ? `Last: ${formatRelativeTime(agent.lastRunAt)}${agent.lastRunDuration !== null ? ` (${formatDuration(agent.lastRunDuration)})` : ""}`
              : ""}
          </Text>
        </Box>
        <Box width={25}>
          <Text dimColor={!isSelected}>
            {agent.lastRunUsage 
              ? `${agent.lastRunUsage.totalTokens.toLocaleString()}tok $${agent.lastRunUsage.cost.toFixed(4)}` 
              : ""}
          </Text>
        </Box>
        <Box>
          <Text dimColor={!isSelected}>
            {agent.nextRunAt ? `Next: ${formatTimeUntil(agent.nextRunAt)}` : ""}
          </Text>
        </Box>
      </Box>
      {detail ? (
        <Box paddingLeft={2}>
          <Text color={agent.state === "error" ? "red" : undefined} dimColor={agent.state !== "error" || isSelected} wrap="truncate-end">
            {detail.slice(0, 120)}
          </Text>
        </Box>
      ) : null}
      {agent.taskUrl ? (
        <Box paddingLeft={2}>
          <Text dimColor wrap="truncate-end">Logs: {agent.taskUrl}</Text>
        </Box>
      ) : null}
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
      <Text dimColor>↑/↓: Select agent • Space: Enable/Disable • Ctrl+C: Stop</Text>
    </Box>
  );
}

export default function App({ statusTracker }: { statusTracker: StatusTracker }) {
  const [agents, setAgents] = useState<AgentStatus[]>(() => statusTracker.getAllAgents());
  const [info, setInfo] = useState<SchedulerInfo | null>(() => statusTracker.getSchedulerInfo());
  const [logs, setLogs] = useState<LogLine[]>(() => statusTracker.getRecentLogs(5));
  const [baseImageStatus, setBaseImageStatus] = useState<string | null>(() => statusTracker.getBaseImageStatus());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tick, setTick] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(agents.length - 1, prev + 1));
    } else if (input === " " && agents.length > 0) {
      // Toggle agent enabled/disabled state
      const selectedAgent = agents[selectedIndex];
      if (selectedAgent) {
        if (selectedAgent.enabled) {
          statusTracker.disableAgent(selectedAgent.name);
        } else {
          statusTracker.enableAgent(selectedAgent.name);
        }
      }
    }
  });

  useEffect(() => {
    const update = () => {
      const newAgents = statusTracker.getAllAgents();
      setAgents(newAgents);
      setInfo(statusTracker.getSchedulerInfo());
      setLogs(statusTracker.getRecentLogs(5));
      setBaseImageStatus(statusTracker.getBaseImageStatus());
      
      // Adjust selection if agents list changed
      if (selectedIndex >= newAgents.length) {
        setSelectedIndex(Math.max(0, newAgents.length - 1));
      }
    };

    statusTracker.on("update", update);
    update(); // initial render

    // Tick faster during init (for spinner), slower when running
    const interval = info?.initializing ? 100 : 1000;
    const timer = setInterval(() => setTick((t) => t + 1), interval);

    return () => {
      statusTracker.off("update", update);
      clearInterval(timer);
    };
  }, [statusTracker, selectedIndex, info?.initializing]);

  if (info?.initializing) {
    return <InitializingView info={info} agents={agents} baseImageStatus={baseImageStatus} tick={tick} />;
  }

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Header info={info} agentCount={agents.length} agents={agents} />
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        {agents.map((agent, index) => (
          <AgentRow key={agent.name} agent={agent} isSelected={index === selectedIndex} />
        ))}
      </Box>
      <RecentActivity logs={logs} />
      <Footer />
    </Box>
  );
}
