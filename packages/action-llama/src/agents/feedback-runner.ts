import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { AgentConfig } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { FeedbackTriggerEvent } from "./feedback-monitor.js";
import { AgentRunner, type RunOutcome } from "./runner.js";
import { agentDir } from "../shared/paths.js";
import { parseFrontmatter } from "../shared/frontmatter.js";
import { stringify as stringifyYAML } from "yaml";

export interface FeedbackContext {
  originalAgentName: string;
  error: string;
  logContext: string[];
  originalSkillPath: string;
}

export class FeedbackRunner extends AgentRunner {
  private feedbackLogger: Logger;

  constructor(agentConfig: AgentConfig, logger: Logger, projectPath: string, statusTracker?: StatusTracker) {
    super(agentConfig, logger, projectPath, statusTracker);
    this.feedbackLogger = logger;
  }

  /**
   * Run the feedback agent with error context
   */
  async runWithFeedback(feedbackEvent: FeedbackTriggerEvent, projectPath: string): Promise<RunOutcome> {
    const originalAgentDir = agentDir(projectPath, feedbackEvent.agentName);
    const originalSkillPath = resolve(originalAgentDir, "SKILL.md");
    
    if (!existsSync(originalSkillPath)) {
      this.feedbackLogger.error({ agentName: feedbackEvent.agentName }, "Original agent SKILL.md not found");
      return { result: "error", triggers: [] };
    }

    // Read the original SKILL.md content
    const originalSkillContent = readFileSync(originalSkillPath, "utf-8");
    
    // Create feedback context
    const feedbackContext: FeedbackContext = {
      originalAgentName: feedbackEvent.agentName,
      error: feedbackEvent.error,
      logContext: feedbackEvent.context,
      originalSkillPath,
    };

    // Build the feedback prompt
    const feedbackPrompt = this.buildFeedbackPrompt(feedbackContext, originalSkillContent);
    
    // Run the feedback agent
    const outcome = await this.run(feedbackPrompt, {
      type: 'agent',
      source: `feedback:${feedbackEvent.agentName}`,
    });

    // If the run was successful, check for updated SKILL.md and copy it back
    if (outcome.result === "completed") {
      await this.copyBackUpdatedSkill(feedbackContext, projectPath);
    }

    return outcome;
  }

  /**
   * Build the prompt for the feedback agent
   */
  private buildFeedbackPrompt(context: FeedbackContext, originalSkillContent: string): string {
    return `# Agent Error Feedback Task

You are a feedback agent designed to fix SKILL.md files for other agents that encountered errors.

## Your Mission

**CRITICAL CONSTRAINTS:**
- DO NOT change the original intent or purpose of the agent
- ONLY fix syntax errors, YAML formatting issues, and obvious typos
- PRESERVE all existing functionality and behavior
- Focus on making the SKILL.md valid and properly formatted

## Error Context

**Agent:** ${context.originalAgentName}
**Error:** ${context.error}

**Log Context:**
\`\`\`
${context.logContext.join("\n")}
\`\`\`

## Original SKILL.md

\`\`\`markdown
${originalSkillContent}
\`\`\`

## Your Task

1. Analyze the error context to understand what went wrong
2. Examine the original SKILL.md for syntax/formatting issues that might have caused the error
3. Create a corrected version that:
   - Maintains identical functionality and behavior
   - Fixes any syntax errors, YAML formatting issues, or typos
   - Preserves all existing agent logic and purpose

## Output

If you need to make changes, write the corrected SKILL.md to \`/tmp/fixed-skill.md\`.

If no changes are needed, create an empty file at \`/tmp/no-changes\`.

**Remember:** Be extremely conservative. When in doubt, make no changes. Only fix clear technical issues, never alter the agent's intended behavior or functionality.`;
  }

  /**
   * Copy the updated SKILL.md back to the original agent directory
   */
  private async copyBackUpdatedSkill(context: FeedbackContext, projectPath: string): Promise<void> {
    const fixedSkillPath = "/tmp/fixed-skill.md";
    const noChangesPath = "/tmp/no-changes";
    
    if (existsSync(noChangesPath)) {
      this.feedbackLogger.info({ agentName: context.originalAgentName }, "Feedback agent determined no changes needed");
      return;
    }

    if (!existsSync(fixedSkillPath)) {
      this.feedbackLogger.warn({ agentName: context.originalAgentName }, "Feedback agent did not produce fixed SKILL.md");
      return;
    }

    try {
      // Read and validate the new SKILL.md
      const newSkillContent = readFileSync(fixedSkillPath, "utf-8");
      
      // Basic validation - ensure it has valid frontmatter
      const { data } = parseFrontmatter(newSkillContent);
      
      // Additional validation could go here
      if (!data || typeof data !== 'object') {
        throw new Error("Invalid YAML frontmatter in corrected SKILL.md");
      }

      // Create backup of original
      const originalSkillPath = context.originalSkillPath;
      const backupPath = `${originalSkillPath}.backup-${Date.now()}`;
      const originalContent = readFileSync(originalSkillPath, "utf-8");
      writeFileSync(backupPath, originalContent);

      // Write the corrected SKILL.md
      writeFileSync(originalSkillPath, newSkillContent);

      this.feedbackLogger.info({ 
        agentName: context.originalAgentName, 
        backupPath,
        originalPath: originalSkillPath,
      }, "Updated agent SKILL.md with feedback corrections");

    } catch (err) {
      this.feedbackLogger.error({ 
        err, 
        agentName: context.originalAgentName,
        fixedSkillPath,
      }, "Error validating or copying corrected SKILL.md");
    }
  }
}