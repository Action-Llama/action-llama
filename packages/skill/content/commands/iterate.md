# Iterate on an agent

Run an agent, analyze its output, and improve its instructions. Repeats up to 3 cycles or until the agent runs cleanly.

## Rules

- Only modify the markdown body (instructions) of SKILL.md, not the YAML frontmatter, unless you ask the user first.
- Stop iterating when the agent completes without errors or after 3 cycles.

## Steps (per cycle)

1. Call `al_status` to ensure the scheduler is running. Start it with `al_start` if needed.

2. Call `al_run` with the agent name (use `$ARGUMENTS` if provided).

3. Wait for the run to complete, then call `al_logs` with `lines: 300` to get the full output.

4. Analyze the result:
   - Did the agent complete its task successfully?
   - Were there errors, unnecessary steps, or suboptimal behavior?

5. If improvements are needed:
   - Read the current SKILL.md file
   - Edit the instruction body to address the issues found
   - Explain what you changed and why
   - Start the next cycle

6. If the run was clean, report success and summarize what was changed across all cycles.
