import { beforeEach, afterEach } from "vitest";
import { E2ETestContext } from "./harness.js";
import { promises as fs } from "fs";
import path from "path";

let testContext: E2ETestContext | undefined;
let testIndex = 0;

/** Host directory where coverage reports are collected across all tests. */
const coverageDir = process.env.AL_COVERAGE_DIR || "/tmp/e2e-coverage";

beforeEach(async () => {
  testContext = new E2ETestContext();
  await testContext.setup();
});

afterEach(async () => {
  if (testContext) {
    // When coverage mode is enabled, extract coverage from all containers
    // before they are destroyed by cleanup()
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
    throw new Error("Test context not initialized");
  }
  return testContext;
}
