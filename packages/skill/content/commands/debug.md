# Debug a failing agent

Diagnose why an agent is failing and suggest fixes.

## Steps

1. Identify the agent to debug (use `$ARGUMENTS` if provided, otherwise ask).

2. Call `al_logs` with the agent name, `level: "warn"`, `lines: 500` to pull recent warnings and errors.

3. Call `al_agents` with the agent name to read its full config and SKILL.md body.

4. Analyze the logs and agent configuration to identify the root cause. Common issues:
   - Missing or expired credentials
   - Malformed SKILL.md frontmatter
   - Instructions that lead to tool errors
   - Rate limiting or API failures
   - Docker/container issues

5. Present a diagnosis with:
   - **Root cause**: What's going wrong and why
   - **Evidence**: Relevant log lines
   - **Fix**: Concrete changes to make (SKILL.md edits, credential updates, config changes)

6. Offer to apply the fix directly.
