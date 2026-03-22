import { beforeEach, afterEach } from "vitest";
import { E2ETestContext } from "./harness.js";

let testContext: E2ETestContext | undefined;

beforeEach(async () => {
  testContext = new E2ETestContext();
  await testContext.setup();
});

afterEach(async () => {
  if (testContext) {
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