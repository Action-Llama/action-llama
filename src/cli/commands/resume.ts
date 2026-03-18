import { resolve } from "path";
import { gatewayFetch } from "../gateway-client.js";

export async function execute(name: string | undefined, opts: { project: string; env?: string }): Promise<void> {
  const projectPath = resolve(opts.project);
  const path = name
    ? `/control/agents/${encodeURIComponent(name)}/resume`
    : "/control/resume";

  let response: Response;
  try {
    response = await gatewayFetch({
      project: projectPath,
      path,
      method: "POST",
      env: opts.env,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      throw new Error("Scheduler not running. Start it with 'al start'.");
    }
    throw error;
  }

  const data = await response.json();

  if (response.ok) {
    console.log(`${data.message}`);
  } else {
    throw new Error(data.error);
  }
}
