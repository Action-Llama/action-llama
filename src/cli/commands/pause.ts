import { loadGlobalConfig } from "../../shared/config.js";
import { resolve } from "path";

export async function execute(opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);
  const globalConfig = loadGlobalConfig(projectPath);
  const gatewayPort = globalConfig.gateway?.port || 8080;
  
  try {
    const response = await fetch(`http://localhost:${gatewayPort}/control/pause`, {
      method: 'POST',
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log(`⏸️  ${data.message}`);
    } else {
      console.error(`❌ Error: ${data.error}`);
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      console.error(`❌ Error: Gateway not running. Start the scheduler with --gateway (-g) flag.`);
    } else {
      console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  }
}