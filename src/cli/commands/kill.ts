import { loadGlobalConfig } from "../../shared/config.js";
import { resolve } from "path";

export async function execute(instanceId: string, opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);
  const globalConfig = loadGlobalConfig(projectPath);
  const gatewayPort = globalConfig.gateway?.port || 8080;

  let response: Response;
  try {
    response = await fetch(`http://localhost:${gatewayPort}/control/kill/${instanceId}`, {
      method: 'POST',
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
