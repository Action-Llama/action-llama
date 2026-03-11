export interface TriggerRequest {
  agent: string;
  context: string;
}

const TRIGGER_PATTERN = /\[TRIGGER:\s*(\S+)\]([\s\S]*?)\[\/TRIGGER\]/g;

/**
 * Extracts trigger requests from agent output text
 */
export function parseTriggers(text: string): TriggerRequest[] {
  const triggers: TriggerRequest[] = [];
  let match;
  
  while ((match = TRIGGER_PATTERN.exec(text)) !== null) {
    const agentName = match[1];
    const context = match[2].trim();
    
    // Basic validation that agent name is valid (no whitespace, special chars)
    if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
      console.warn(`Invalid agent name in trigger: "${agentName}" - agent names must contain only letters, numbers, underscores, and hyphens`);
      continue;
    }
    
    triggers.push({ agent: agentName, context });
  }
  
  return triggers;
}

/**
 * Check if the output contains a rerun request
 */
export function hasRerunRequest(text: string): boolean {
  return text.includes("[RERUN]");
}

/**
 * Extract status messages from agent output (pattern: [STATUS: message])
 */
export function extractStatusMessage(text: string): string | undefined {
  const statusMatch = text.match(/\[STATUS:\s*([^\]]+)\]/);
  return statusMatch ? statusMatch[1].trim() : undefined;
}