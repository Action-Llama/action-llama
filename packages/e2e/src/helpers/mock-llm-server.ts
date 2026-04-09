/**
 * Mock LLM server implementing the OpenAI chat completions SSE streaming API.
 *
 * Used by e2e tests to control agent behavior without real LLM calls.
 * The Pi SDK requires streaming (hardcoded stream: true), so this server
 * emits SSE events in the OpenAI streaming format.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "http";

// --- Public types ---

export type MockResponse =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "error"; status: number; message: string };

export interface ReceivedRequest {
  messages: Array<{ role: string; content?: string; tool_calls?: unknown[] }>;
  tools?: unknown[];
  model: string;
  timestamp: number;
}

// --- SSE helpers ---

let responseCounter = 0;

function makeChunk(id: string, delta: Record<string, unknown>, finishReason: string | null, usage?: Record<string, number> | null): string {
  return JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "mock-model",
    choices: [{
      index: 0,
      delta,
      finish_reason: finishReason,
    }],
    usage: usage ?? null,
  });
}

function emitTextResponse(res: ServerResponse, text: string): void {
  const id = `mock-${++responseCounter}`;

  // Role chunk
  res.write(`data: ${makeChunk(id, { role: "assistant", content: "" }, null)}\n\n`);

  // Content chunk (full text in one go)
  res.write(`data: ${makeChunk(id, { content: text }, null)}\n\n`);

  // Finish chunk with usage
  res.write(`data: ${makeChunk(id, {}, "stop", { prompt_tokens: 10, completion_tokens: text.length, total_tokens: 10 + text.length })}\n\n`);

  res.write("data: [DONE]\n\n");
  res.end();
}

function emitToolCallResponse(res: ServerResponse, name: string, args: Record<string, unknown>): void {
  const id = `mock-${++responseCounter}`;
  const callId = `call_${responseCounter}`;

  // Role chunk
  res.write(`data: ${makeChunk(id, { role: "assistant" }, null)}\n\n`);

  // Tool call chunk (name + full args in one event)
  res.write(`data: ${makeChunk(id, {
    tool_calls: [{
      index: 0,
      id: callId,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    }],
  }, null)}\n\n`);

  // Finish chunk
  const argsStr = JSON.stringify(args);
  res.write(`data: ${makeChunk(id, {}, "tool_calls", { prompt_tokens: 10, completion_tokens: argsStr.length, total_tokens: 10 + argsStr.length })}\n\n`);

  res.write("data: [DONE]\n\n");
  res.end();
}

function emitErrorResponse(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message, type: "mock_error", code: status } }));
}

// --- MockLLMServer class ---

export class MockLLMServer {
  private server: Server | null = null;
  private _port = 0;
  private responseQueue: MockResponse[] = [];
  private _requests: ReceivedRequest[] = [];

  get port(): number {
    return this._port;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this._port}/v1`;
  }

  /** Enqueue a text response. */
  enqueueTextResponse(text: string): void {
    this.responseQueue.push({ type: "text", text });
  }

  /** Enqueue a tool call response. */
  enqueueToolCall(name: string, args: Record<string, unknown>): void {
    this.responseQueue.push({ type: "tool_call", name, args });
  }

  /** Enqueue multiple responses in order. */
  enqueueConversation(steps: MockResponse[]): void {
    this.responseQueue.push(...steps);
  }

  /** Assert all queued responses have been consumed. */
  assertDrained(): void {
    if (this.responseQueue.length > 0) {
      throw new Error(
        `MockLLMServer: ${this.responseQueue.length} response(s) remaining in queue. ` +
        `Types: ${this.responseQueue.map((r) => r.type).join(", ")}`,
      );
    }
  }

  /** Get all received requests for inspection. */
  getRequests(): ReceivedRequest[] {
    return [...this._requests];
  }

  /** Reset state — clear queue and request history. */
  reset(): void {
    this.responseQueue = [];
    this._requests = [];
  }

  /** Start the mock server on a random port. */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address();
        if (typeof addr === "object" && addr) {
          this._port = addr.port;
        }
        resolve();
      });
      this.server.on("error", reject);
    });
  }

  /** Stop the mock server. */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Only handle POST /v1/chat/completions
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Not found", type: "not_found" } }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let parsed: any;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Invalid JSON", type: "invalid_request" } }));
        return;
      }

      // Record the request
      this._requests.push({
        messages: parsed.messages ?? [],
        tools: parsed.tools,
        model: parsed.model ?? "unknown",
        timestamp: Date.now(),
      });

      // Dequeue next response
      const response = this.responseQueue.shift();
      if (!response) {
        emitErrorResponse(res, 500, "MockLLMServer: response queue is empty — no response enqueued for this request");
        return;
      }

      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      switch (response.type) {
        case "text":
          emitTextResponse(res, response.text);
          break;
        case "tool_call":
          emitToolCallResponse(res, response.name, response.args);
          break;
        case "error":
          // Close the SSE stream and send error via separate response
          res.end();
          break;
      }
    });
  }
}
