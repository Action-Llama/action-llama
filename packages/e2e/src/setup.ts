import { afterEach } from "vitest";
import { E2ETestContext } from "./harness.js";
import path from "path";

let testContext: E2ETestContext | undefined;
let testIndex = 0;

/** Host directory where coverage reports are collected across all tests. */
const coverageDir = process.env.AL_COVERAGE_DIR || "/tmp/e2e-coverage";

// Context is created lazily via getTestContext() — only tests that need it
// (cli-flows, deployment-flows) pay the setup cost. Tests using beforeAll
// with their own context skip this entirely.

afterEach(async () => {
  if (testContext) {
    if (process.env.AL_COVERAGE === "1") {
      const { extractCoverageFromContainer } = await import("./containers/local.js");
      for (const container of testContext.getContainers()) {
        const dest = path.join(coverageDir, `test-${testIndex++}`);
        await extractCoverageFromContainer(testContext, container, dest).catch(() => {});
      }
    }

    await testContext.cleanup();
    testContext = undefined;
  }
});

export function getTestContext(): E2ETestContext {
  if (!testContext) {
    testContext = new E2ETestContext();
  }
  return testContext;
}
