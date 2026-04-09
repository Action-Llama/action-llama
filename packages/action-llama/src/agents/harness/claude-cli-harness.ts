import { spawn, type ChildProcessByStdio } from "child_process";
import type { Readable } from "stream";
import { createInterface } from "readline";
import type { ModelConfig } from "../../shared/config.js";
import type { TokenUsage } from "../../shared/usage.js";
import { zeroTokenUsage } from "../../shared/usage.js";
import type { AgentHarness, HarnessEvent, HarnessRunOpts } from "./types.js";

export interface ClaudeCliHarnessOpts {
  model: ModelConfig;
  spawnImpl?: typeof spawn;
}

type ClaudeUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

function mapThinkingLevel(thinkingLevel: ModelConfig["thinkingLevel"]): string {
  switch (thinkingLevel) {
    case "off":
    case "minimal":
      return "low";
    case "low":
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "xhigh":
      return "max";
    default:
      return "medium";
  }
}

function toTokenUsage(usage?: ClaudeUsage): TokenUsage {
  if (!usage) return zeroTokenUsage();
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens,
    cost: 0,
    turnCount: outputTokens > 0 ? 1 : 0,
  };
}

function getMessageBlocks(event: any): any[] {
  if (Array.isArray(event?.message?.content)) return event.message.content;
  if (Array.isArray(event?.content)) return event.content;
  return [];
}

function getMessageId(event: any): string {
  return String(event?.message?.id || event?.uuid || "assistant");
}

export class ClaudeCliHarness implements AgentHarness {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;

  constructor(private opts: ClaudeCliHarnessOpts) {}

  async *run(prompt: string, runOpts: HarnessRunOpts): AsyncIterable<HarnessEvent> {
    const spawnImpl = this.opts.spawnImpl ?? spawn;
    const args = [
      "-p",
      prompt,
      "--verbose",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      runOpts.cwd,
      "--model",
      this.opts.model.model,
      "--effort",
      mapThinkingLevel(this.opts.model.thinkingLevel),
    ];

    const env = {
      ...process.env,
      ...runOpts.env,
    };

    const child = spawnImpl("claude", args, {
      cwd: runOpts.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    yield {
      type: "log",
      level: "info",
      message: "creating agent session",
      data: { model: this.opts.model.model, thinking: this.opts.model.thinkingLevel },
    };

    const queue: HarnessEvent[] = [];
    let done = false;
    let waitError: Error | undefined;
    let finalUsage: TokenUsage | undefined;
    const assistantText = new Map<string, string>();

    const pushEvent = (event: HarnessEvent) => {
      queue.push(event);
    };

    const handleJsonLine = (line: string) => {
      if (!line.trim()) return;

      let parsed: any;
      try {
        parsed = JSON.parse(line);
      } catch {
        pushEvent({
          type: "log",
          level: "debug",
          message: "event",
          data: { raw: line.slice(0, 500) },
        });
        return;
      }

      if (parsed.type === "result") {
        finalUsage = toTokenUsage(parsed.usage);
        return;
      }

      if (parsed.type === "system" && parsed.subtype === "api_error") {
        pushEvent({
          type: "log",
          level: "error",
          message: "session error",
          data: { error: String(parsed.error?.error?.error?.message || parsed.error?.message || "Claude CLI API error") },
        });
        return;
      }

      if (parsed.type === "assistant") {
        const messageId = getMessageId(parsed);
        for (const block of getMessageBlocks(parsed)) {
          if (block.type === "text" && typeof block.text === "string") {
            const previous = assistantText.get(messageId) || "";
            const next = block.text;
            const delta = next.startsWith(previous) ? next.slice(previous.length) : next;
            assistantText.set(messageId, next);
            if (delta) {
              pushEvent({ type: "text_delta", delta });
            }
          }

          if (block.type === "tool_use") {
            const command = typeof block.input?.command === "string" ? block.input.command : undefined;
            pushEvent({
              type: "tool_start",
              toolName: String(block.name || "tool").toLowerCase(),
              toolCallId: String(block.id || messageId),
              command,
            });
          }
        }

        if (parsed.message?.stop_reason && parsed.message?.stop_reason !== "tool_use") {
          const data: Record<string, any> = {
            eventType: "message_end",
            role: parsed.message?.role || "assistant",
            stopReason: parsed.message?.stop_reason,
            raw: parsed,
          };
          // When the API returns stop_reason="error", extract error details
          // so they surface in the session-ended log.
          if (parsed.message.stop_reason === "error") {
            const content = parsed.message.content;
            const errDetail = parsed.message.error || parsed.error;
            const parts: string[] = [];
            if (errDetail) {
              parts.push(typeof errDetail === "string" ? errDetail : (errDetail.message || JSON.stringify(errDetail)));
            }
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "text" && block.text) parts.push(String(block.text).slice(0, 500));
              }
            }
            if (parts.length > 0) {
              data.errorMessage = parts.join(" — ").slice(0, 500);
            }
          }
          pushEvent({
            type: "log",
            level: "debug",
            message: "conversation.event",
            data,
          });
        }
        return;
      }

      if (parsed.type === "user") {
        for (const block of getMessageBlocks(parsed)) {
          if (block.type !== "tool_result") continue;
          const result =
            typeof block.content === "string"
              ? block.content
              : JSON.stringify({
                  content: Array.isArray(block.content) ? block.content : [{ type: "text", text: String(block.content ?? "") }],
                  details: {},
                });

          pushEvent({
            type: "tool_end",
            toolName: "tool",
            toolCallId: String(block.tool_use_id || "tool"),
            result,
            isError: !!block.is_error,
            raw: parsed,
          });
        }
      }
    };

    const stdoutRl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    stdoutRl.on("line", handleJsonLine);

    const stderrRl = createInterface({ input: child.stderr, crlfDelay: Infinity });
    stderrRl.on("line", (line) => {
      if (!line.trim()) return;
      pushEvent({
        type: "log",
        level: "warn",
        message: "claude stderr",
        data: { text: line.slice(0, 500) },
      });
    });

    child.on("error", (err) => {
      waitError = err;
    });

    child.on("close", (code, signal) => {
      stdoutRl.close();
      stderrRl.close();

      if (finalUsage) {
        pushEvent({ type: "usage", usage: finalUsage });
      }

      if (signal) {
        pushEvent({
          type: "log",
          level: "warn",
          message: "claude process terminated",
          data: { signal },
        });
      }

      pushEvent({
        type: "exit",
        aborted: code !== 0,
        allModelsExhausted: false,
      });
      done = true;
    });

    while (!done || queue.length > 0) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }

      if (waitError) {
        const err = waitError;
        waitError = undefined;
        throw err;
      }

      if (!done) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }

  dispose(): void {
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
    this.child = null;
  }
}
