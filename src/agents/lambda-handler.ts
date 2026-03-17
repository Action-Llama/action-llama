/**
 * Lambda Runtime API handler for container images.
 *
 * Lambda container images must implement the Runtime API protocol.
 * This handler replaces the default ENTRYPOINT on Lambda via ImageConfig,
 * keeping container-entry.ts as the direct entrypoint for Docker/ECS.
 *
 * During init: initAgent() runs once (loads config, creates model/resourceLoader).
 * During invocation: handleInvocation() runs per-request (credentials, session).
 */

import { initAgent, handleInvocation } from "./container-entry.js";

const RUNTIME_API = process.env.AWS_LAMBDA_RUNTIME_API;

function emitLog(level: string, msg: string, data?: Record<string, any>) {
  console.log(JSON.stringify({ _log: true, level, msg, ...data, ts: Date.now() }));
}

async function main() {
  if (!RUNTIME_API) {
    throw new Error("AWS_LAMBDA_RUNTIME_API not set — this file should only run on Lambda");
  }

  // Init phase — runs once during cold start. Hoists reusable work
  // (PATH setup, signal dir, config parsing, model creation) out of
  // the per-invocation hot path.
  const init = await initAgent();

  // Lambda Runtime API loop. After each invocation completes and the
  // response is posted, the loop blocks on /next and Lambda freezes the
  // execution environment until the next invoke (or the function times out).
  // The scheduler detects results via CloudWatch log parsing (signal-result
  // for reruns, REPORT line for errors), not the process exit code.
  while (true) {
    // Block until Lambda delivers the next invocation
    const nextRes = await fetch(
      `http://${RUNTIME_API}/2018-06-01/runtime/invocation/next`,
    );
    const requestId = nextRes.headers.get("lambda-runtime-aws-request-id");
    if (!requestId) {
      emitLog("error", "no request ID in Lambda invocation response");
      process.exit(1);
    }

    try {
      // Parse the invoke payload — secrets are passed here (not env vars)
      // to stay under Lambda's 4 KB env-var limit and enforce least-privilege
      // (the container never gets Secrets Manager access).
      try {
        const body = await nextRes.json() as Record<string, any>;
        if (body?.secrets && typeof body.secrets === "object") {
          for (const [key, value] of Object.entries(body.secrets)) {
            if (typeof value === "string") {
              process.env[key] = value;
            }
          }
        }
      } catch {
        // Payload may be empty or malformed — continue without secrets
      }

      const exitCode = await handleInvocation(init);

      await fetch(
        `http://${RUNTIME_API}/2018-06-01/runtime/invocation/${requestId}/response`,
        {
          method: "POST",
          body: JSON.stringify({ statusCode: exitCode === 0 ? 200 : exitCode }),
        },
      );

      // Don't call process.exit() — let the loop continue so Lambda can
      // freeze the environment cleanly. Exiting here would race with
      // Lambda's internal response processing and cause Runtime.ExitError.
    } catch (err: any) {
      emitLog("error", "lambda handler error", { error: err.message, stack: err.stack?.split("\n").slice(0, 3).join("\n") });

      try {
        await fetch(
          `http://${RUNTIME_API}/2018-06-01/runtime/invocation/${requestId}/error`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              errorMessage: err.message,
              errorType: err.name || "Error",
            }),
          },
        );
      } catch {
        // Best-effort error reporting
      }

      // Don't exit — loop back so Lambda can freeze the environment.
      // The error was already reported via the /error endpoint.
    }
  }
}

main();
