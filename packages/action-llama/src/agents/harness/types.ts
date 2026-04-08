/**
 * Swappable agent harness interface.
 *
 * Each harness implementation (Pi, Claude CLI) converts its native event
 * stream into a common `HarnessEvent` iterable that callers consume
 * without knowing which harness is running.
 */
import type { TokenUsage } from "../../shared/usage.js";
import type { HarnessConfig, HarnessType } from "../../shared/config.js";

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type HarnessEvent =
  | HarnessLogEvent
  | HarnessTextDeltaEvent
  | HarnessToolStartEvent
  | HarnessToolEndEvent
  | HarnessUsageEvent
  | HarnessExitEvent;

export interface HarnessLogEvent {
  type: "log";
  level: "info" | "debug" | "warn" | "error";
  message: string;
  data?: Record<string, any>;
}

export interface HarnessTextDeltaEvent {
  type: "text_delta";
  delta: string;
}

export interface HarnessToolStartEvent {
  type: "tool_start";
  toolName: string;
  toolCallId: string;
  /** For bash tools, the command being run */
  command?: string;
}

export interface HarnessToolEndEvent {
  type: "tool_end";
  toolName: string;
  toolCallId: string;
  result: string;
  isError: boolean;
}

export interface HarnessUsageEvent {
  type: "usage";
  usage: TokenUsage;
}

export interface HarnessExitEvent {
  type: "exit";
  aborted: boolean;
  allModelsExhausted: boolean;
}

// ---------------------------------------------------------------------------
// Harness interface
// ---------------------------------------------------------------------------

export interface HarnessRunOpts {
  cwd: string;
  /** Environment variables passed to the agent process / SDK auth */
  env?: Record<string, string>;
}

export interface AgentHarness {
  run(prompt: string, opts: HarnessRunOpts): AsyncIterable<HarnessEvent>;
  dispose(): void;
}

export type { HarnessConfig, HarnessType };
