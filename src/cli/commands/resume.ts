import { resolve } from "path";
import { gatewayFetch } from "../gateway-client.js";

export async function execute(opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);

  let response: Response;
  try {
    response = await gatewayFetch({
      project: projectPath,
      path: "/control/resume",
      method: "POST",
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      throw new Error("Gateway not running. Start the scheduler with --gateway (-g) flag.");
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
