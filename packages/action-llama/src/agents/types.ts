import type { TokenUsage } from "../shared/usage.js";

export type RunResult = "completed" | "rerun" | "error";

export interface TriggerRequest {
  agent: string;
  context: string;
}

export interface RunOutcome {
  result: RunResult;
  triggers: TriggerRequest[];
  returnValue?: string;
  exitCode?: number;
  exitReason?: string;
  usage?: TokenUsage;
  preHookMs?: number;
  postHookMs?: number;
}
