import type { Hono } from "hono";
import { loadGlobalConfig } from "../../shared/config.js";
import { loadCredentialField } from "../../shared/credentials.js";
import type { ModelConfig } from "../../shared/config/types.js";
import type { ModelProvider, ChatMessage } from "../../models/types.js";
import { OpenAIProvider } from "../../models/providers/openai.js";
import { AnthropicProvider } from "../../models/providers/anthropic.js";
import { CustomProvider } from "../../models/providers/custom.js";
import type { StatsStore } from "../../stats/store.js";
import type { Logger } from "../../shared/logger.js";
import {
  SAFE_AGENT_NAME,
  MAX_LINES,
  findLatestLogFile,
  readLastEntries,
} from "./log-helpers.js";

// In-memory cache for summaries of completed runs
const summaryCache = new Map<string, string>();

const DEFAULT_SUMMARY_LINES = 500;

function createProvider(model: ModelConfig, apiKey: string): ModelProvider {
  switch (model.provider) {
    case "anthropic":
      return new AnthropicProvider({ ...model, apiKey });
    case "openai":
      return new OpenAIProvider({ ...model, apiKey });
    default:
      // custom/openrouter/groq/etc. all use OpenAI-compatible API
      return new CustomProvider({ ...model, apiKey });
  }
}

export function registerLogSummaryRoutes(
  app: Hono,
  projectPath: string,
  statsStore?: StatsStore,
  logger?: Logger,
): void {
  app.post("/api/logs/agents/:name/:instanceId/summarize", async (c) => {
    const name = c.req.param("name");
    const instanceId = c.req.param("instanceId");

    if (!SAFE_AGENT_NAME.test(name)) return c.json({ error: "Invalid agent name" }, 400);
    if (!SAFE_AGENT_NAME.test(instanceId)) return c.json({ error: "Invalid instance ID" }, 400);

    // Parse optional filter params
    const query = c.req.query();
    let lines = parseInt(query.lines || "", 10);
    if (isNaN(lines) || lines < 1) lines = DEFAULT_SUMMARY_LINES;
    if (lines > MAX_LINES) lines = MAX_LINES;

    const after = query.after ? parseInt(query.after, 10) : undefined;
    const before = query.before ? parseInt(query.before, 10) : undefined;
    const grep = query.grep || undefined;

    let grepRe: RegExp | undefined;
    if (grep) {
      try { grepRe = new RegExp(grep); }
      catch { return c.json({ error: "Invalid grep pattern" }, 400); }
    }

    // Check cache for completed runs (only for default request)
    const cacheKey = instanceId;
    if (!query.lines && !query.after && !query.before && !query.grep) {
      // Check in-memory cache first (fast path)
      const cached = summaryCache.get(cacheKey);
      if (cached) {
        return c.json({ summary: cached, cached: true });
      }
      // Fall back to DB-persisted summary
      try {
        const run = statsStore?.queryRunByInstanceId(instanceId);
        if (run?.summary) {
          summaryCache.set(cacheKey, run.summary);
          return c.json({ summary: run.summary, cached: true });
        }
      } catch {
        // Non-critical — ignore cache errors
      }
    }

    // Read log entries
    const file = findLatestLogFile(projectPath, name);
    if (!file) {
      return c.json({ summary: "No log entries found for this instance.", cached: false });
    }

    const { entries } = await readLastEntries(
      file,
      lines,
      isNaN(after as number) ? undefined : after,
      isNaN(before as number) ? undefined : before,
      instanceId,
      grepRe,
    );

    if (entries.length === 0) {
      return c.json({ summary: "No log entries found for this instance.", cached: false });
    }

    // Resolve model from project config
    let globalConfig;
    try {
      globalConfig = loadGlobalConfig(projectPath);
    } catch (err) {
      const msg = `Failed to load project config: ${err instanceof Error ? err.message : String(err)}`;
      logger?.error({ agent: name, err }, msg);
      return c.json({ error: msg }, 500);
    }

    if (!globalConfig.models || Object.keys(globalConfig.models).length === 0) {
      logger?.error({ agent: name }, "No models configured in project config");
      return c.json({ error: "No models configured in project config" }, 500);
    }

    const model = Object.values(globalConfig.models)[0];

    // Resolve API key from credential store
    const credType = `${model.provider}_key`;
    let apiKey: string;
    try {
      const key = await loadCredentialField(credType, "default", "token");
      apiKey = key ?? "";
    } catch {
      apiKey = "";
    }

    // Build prompt
    const logText = entries
      .map((e) => `[${new Date(e.time).toISOString()}] ${e.msg}`)
      .join("\n");

    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are a concise technical assistant. Summarize the following agent run logs using this structure: Describe what the agent operated on in less than 10 words. Describe what it did in less than 10 words. If there were errors, describe them in less than 10 words. Output only the summary text — no timestamps, no log formatting, no bullet points or labels.",
      },
      {
        role: "user",
        content: `Here are the logs from an agent run:\n\n${logText}`,
      },
    ];

    // Call model
    let summary: string;
    try {
      const provider = createProvider(model, apiKey);
      const response = await provider.chat(messages, { max_tokens: 300 });
      summary = response.content;
    } catch (err) {
      const msg = `Failed to generate summary: ${err instanceof Error ? err.message : String(err)}`;
      logger?.error({ agent: name, instanceId, err }, msg);
      return c.json({ error: msg }, 500);
    }

    // Persist and cache for completed runs
    if (!query.lines && !query.after && !query.before && !query.grep) {
      try {
        const run = statsStore?.queryRunByInstanceId(instanceId);
        if (run && run.result) {
          summaryCache.set(cacheKey, summary);
          statsStore?.updateRunSummary(instanceId, summary);
        }
      } catch {
        // Non-critical — ignore cache errors
      }
    }

    return c.json({ summary, cached: false });
  });
}
