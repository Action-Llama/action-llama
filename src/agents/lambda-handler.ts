/**
 * Lambda Runtime API handler for container images.
 *
 * Lambda container images must implement the Runtime API protocol.
 * This handler replaces the default ENTRYPOINT on Lambda via ImageConfig,
 * keeping container-entry.ts as the direct entrypoint for Docker/ECS.
 *
 * During init (module load): only imports are executed — fast, well under
 * Lambda's 10-second init timeout.
 *
 * During invocation: runAgent() is called, which does all the real work
 * (loading config, credentials, running the LLM session).
 */

const RUNTIME_API = process.env.AWS_LAMBDA_RUNTIME_API;

function emitLog(level: string, msg: string, data?: Record<string, any>) {
  console.log(JSON.stringify({ _log: true, level, msg, ...data, ts: Date.now() }));
}

async function main() {
  if (!RUNTIME_API) {
    throw new Error("AWS_LAMBDA_RUNTIME_API not set — this file should only run on Lambda");
  }

  // Lazy-import runAgent so module loading stays fast during init.
  const { runAgent } = await import("./container-entry.js");

  // Lambda Runtime API loop. In practice, each agent invocation runs for
  // minutes, so this loop only executes once before the process exits.
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
      const exitCode = await runAgent();

      await fetch(
        `http://${RUNTIME_API}/2018-06-01/runtime/invocation/${requestId}/response`,
        {
          method: "POST",
          body: JSON.stringify({ statusCode: exitCode === 0 ? 200 : exitCode }),
        },
      );

      // Exit with the agent's exit code so Lambda's REPORT line reflects
      // success/failure and the scheduler can detect [RERUN] (exit 42).
      process.exit(exitCode);
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

      process.exit(1);
    }
  }
}

main();
