import { E2ETestContext, ContainerInfo } from "../harness.js";
import { poll } from "../poll.js";
import path from "path";

export async function setupLocalActionLlama(context: E2ETestContext): Promise<ContainerInfo> {
  const containerInfo = await context.createLocalActionLlamaContainer();

  // Initialize test project, config, and mock credentials in a single exec
  await context.executeInContainer(containerInfo, [
    "bash", "-c", `
mkdir -p /home/testuser/test-project \
         ~/.action-llama/credentials/github_token/default \
         ~/.action-llama/credentials/anthropic_key/default

cat > /home/testuser/test-project/config.toml << 'TOML'
[models.sonnet]
provider = "anthropic"
model = "claude-3-5-sonnet-20241022"
authType = "api_key"
TOML

cat > /home/testuser/test-project/package.json << 'JSON'
{
  "name": "test-project",
  "private": true,
  "type": "module",
  "dependencies": {
    "@action-llama/action-llama": "next"
  }
}
JSON

echo -n 'mock-token' > ~/.action-llama/credentials/github_token/default/token
echo -n 'mock-key' > ~/.action-llama/credentials/anthropic_key/default/token
`
  ]);

  return containerInfo;
}

export async function createTestAgent(
  context: E2ETestContext,
  containerInfo: ContainerInfo,
  agentName: string,
  skill: string
): Promise<void> {
  const agentDir = `/home/testuser/test-project/agents/${agentName}`;

  const skillContent = `---
description: "E2E test agent"
---

${skill}`;

  // Create agent directory, write SKILL.md + config.toml, and fix ownership in one exec
  await context.executeInContainer(containerInfo, [
    "bash", "-c", `
mkdir -p ${agentDir}

cat > ${agentDir}/SKILL.md << 'EOF'
${skillContent}
EOF

cat > ${agentDir}/config.toml << 'EOF'
models = ["sonnet"]
credentials = ["github_token", "anthropic_key"]
schedule = "0 */6 * * *"
EOF

chown -R testuser:testuser ${agentDir}
`
  ]);
}

export async function startActionLlamaScheduler(
  context: E2ETestContext,
  containerInfo: ContainerInfo,
  opts?: { coverage?: boolean }
): Promise<void> {
  const projectPath = "/home/testuser/test-project";

  // Verify project exists, create default agent if needed, and start scheduler — all in one exec
  const enableCoverage = opts?.coverage || process.env.AL_COVERAGE === "1";
  const alCmd = enableCoverage
    ? "c8 --reporter=json --reporter=text --report-dir=/tmp/coverage al start --headless"
    : "al start --headless";

  await context.executeInContainer(containerInfo, [
    "bash", "-c", `
cd ${projectPath} || exit 1
test -f config.toml || { echo "config.toml missing" >&2; exit 1; }

# Create default test agent if none exist
if ! ls agents/ 2>/dev/null | grep -q .; then
  mkdir -p agents/test-agent
  cat > agents/test-agent/SKILL.md << 'EOF'
---
description: "Default test agent for E2E testing"
---

# Default Test Agent

You are a default test agent created for E2E testing.
EOF
  cat > agents/test-agent/config.toml << 'EOF'
models = ["sonnet"]
credentials = ["github_token", "anthropic_key"]
schedule = "0 */6 * * *"
EOF
  chown -R testuser:testuser agents
fi

nohup ${alCmd} > /tmp/scheduler.log 2>&1 & echo $! > /tmp/scheduler.pid
`
  ]);

  // Wait for scheduler to start — check PID is alive and gateway health endpoint responds.
  // Using curl is much faster than `al stat` (avoids full Node.js startup per poll iteration).
  try {
    await poll(async () => {
      const check = await context.executeInContainer(containerInfo, [
        "bash", "-c",
        `[ -f /tmp/scheduler.pid ] && kill -0 $(cat /tmp/scheduler.pid) 2>/dev/null && curl -sf http://localhost:8080/health >/dev/null 2>&1 && echo ok || echo fail`,
      ]);
      return check.includes("ok");
    }, { timeoutMs: 30_000, initialDelayMs: 200, label: "scheduler to start" });
  } catch {
    const logs = await getSchedulerLogs(context, containerInfo);
    throw new Error(`Scheduler failed to start properly. Logs: ${logs}`);
  }
}

export async function stopActionLlamaScheduler(
  context: E2ETestContext,
  containerInfo: ContainerInfo
): Promise<void> {
  try {
    // Send SIGTERM and wait for exit in a single script with short poll intervals.
    // SIGTERM allows c8 to write coverage reports before the process exits.
    await context.executeInContainer(containerInfo, [
      "bash", "-c", `
if [ -f /tmp/scheduler.pid ]; then
  pid=$(cat /tmp/scheduler.pid)
  kill "$pid" 2>/dev/null
  for i in $(seq 1 30); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  rm -f /tmp/scheduler.pid
fi
`
    ]);
  } catch {
    // Process might already be dead
  }
}

/**
 * Extract coverage data from the container to a host directory.
 * Call after stopActionLlamaScheduler when coverage is enabled.
 * Returns the path to the extracted coverage directory, or null if no coverage data.
 */
export async function extractCoverageFromContainer(
  context: E2ETestContext,
  containerInfo: ContainerInfo,
  hostDir: string
): Promise<string | null> {
  try {
    // Check if coverage data exists
    const check = await context.executeInContainer(containerInfo, [
      "bash", "-c", "test -d /tmp/coverage && ls /tmp/coverage/ | head -1 | grep -q . && echo 'exists' || echo 'missing'"
    ]);

    if (check.includes("missing")) {
      return null;
    }

    // Extract coverage via tar through the container
    await context.extractFromContainer(containerInfo, "/tmp/coverage", hostDir);
    return hostDir;
  } catch (error: any) {
    console.warn(`Failed to extract coverage from container: ${error.message}`);
    return null;
  }
}

export async function getSchedulerLogs(
  context: E2ETestContext,
  containerInfo: ContainerInfo
): Promise<string> {
  try {
    return await context.executeInContainer(containerInfo, [
      "cat", "/tmp/scheduler.log"
    ]);
  } catch {
    return "No scheduler logs available";
  }
}

/**
 * Poll the gateway health endpoint until it returns "ok".
 * Uses exponential backoff. Throws with scheduler logs on timeout.
 */
export async function waitForGateway(
  context: E2ETestContext,
  container: ContainerInfo,
  port: number,
  opts?: { timeoutMs?: number; logFile?: string },
): Promise<void> {
  const logFile = opts?.logFile ?? "/tmp/scheduler.log";
  try {
    await poll(async () => {
      const health = await context.executeInContainer(container, [
        "curl", "-sf", `http://localhost:${port}/health`,
      ]);
      return health.includes("ok");
    }, { timeoutMs: opts?.timeoutMs ?? 30_000, label: `gateway health on port ${port}` });
  } catch {
    let logs: string;
    try {
      logs = await context.executeInContainer(container, ["cat", logFile]);
    } catch {
      logs = "No scheduler logs available";
    }
    throw new Error(`Gateway did not become healthy.\nLogs: ${logs}`);
  }
}

/**
 * Poll the dashboard status API until a specific agent reaches "idle" or "error" state.
 * Used after starting the gateway to wait for image builds to complete.
 */
export async function waitForAgentReady(
  context: E2ETestContext,
  container: ContainerInfo,
  port: number,
  agentName: string,
  cookieJar: string,
  opts?: { timeoutMs?: number },
): Promise<void> {
  await poll(async () => {
    const res = await context.executeInContainer(container, [
      "bash", "-c",
      `curl -sf -b ${cookieJar} -c ${cookieJar} http://localhost:${port}/api/dashboard/status`,
    ]);
    const body = JSON.parse(res);
    const agent = body.agents?.find((a: { name: string }) => a.name === agentName);
    return agent && (agent.state === "idle" || agent.state === "error");
  }, { timeoutMs: opts?.timeoutMs ?? 60_000, label: `agent "${agentName}" to become ready` });
}

export async function runSingleAgent(
  context: E2ETestContext,
  containerInfo: ContainerInfo,
  agentName: string
): Promise<string> {
  return await context.executeInContainer(containerInfo, [
    "bash", "-c", `cd /home/testuser/test-project && al run ${agentName} 2>&1`
  ]);
}