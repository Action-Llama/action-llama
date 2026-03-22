import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("debug: proxy timing", { timeout: 120_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("measure gateway proxy readiness time", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "debug-timing",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "START=$(date +%s)",
            "i=0; while [ $i -lt 60 ]; do",
            '  _h=$(curl -s -w "%{http_code}" --connect-timeout 2 "$GATEWAY_URL/health" 2>/dev/null)',
            '  HC=$(printf "%s" "$_h" | tail -c3)',
            '  NOW=$(date +%s)',
            '  ELAPSED=$((NOW - START))',
            '  echo "attempt=$i elapsed=${ELAPSED}s code=$HC" >&2',
            '  [ "$HC" = "200" ] && break',
            "  i=$((i+1)); sleep 1",
            "done",
            "# Now try rlock",
            '_raw=$(curl -s --connect-timeout 5 --max-time 10 -w "\\n%{http_code}" -X POST "$GATEWAY_URL/locks/acquire" -H "Content-Type: application/json" -d \'{"secret":"\'$SHUTDOWN_SECRET\'","resourceKey":"debug-res"}\' 2>&1)',
            'CODE=$(printf "%s" "$_raw" | tail -n1)',
            'echo "RLOCK_CODE=$CODE" >&2',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    
    // Manually trigger the agent since there are no more automatic initial runs
    await harness.triggerAgent("debug-timing");
    
    const run = await harness.waitForRunResult("debug-timing");
    console.log("Run result:", run.result);
  });
});
