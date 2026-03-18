import { resolve } from "path";
import { gatewayFetch } from "../gateway-client.js";

export async function execute(target: string, opts: { project: string; env?: string }): Promise<void> {
  const projectPath = resolve(opts.project);

  const fetchOpts = {
    project: projectPath,
    method: "POST",
    env: opts.env,
  };

  let response: Response;
  try {
    // Try as agent name first (kills all instances of that agent)
    response = await gatewayFetch({
      ...fetchOpts,
      path: `/control/agents/${encodeURIComponent(target)}/kill`,
    });

    // If agent not found, fall back to instance ID
    if (response.status === 404) {
      response = await gatewayFetch({
        ...fetchOpts,
        path: `/control/kill/${encodeURIComponent(target)}`,
      });
    }
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
