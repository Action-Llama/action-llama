# Run an agent

Trigger an agent run and report the results.

## Steps

1. Call `al_status` to check if the scheduler is running.
   - If not running, call `al_start` to start it and wait for it to become ready.

2. Ask the user which agent to run (or use `$ARGUMENTS` if provided).
   - If unclear, call `al_agents` to list available agents.

3. Call `al_run` with the agent name.

4. Wait a few seconds, then call `al_logs` with the agent name, `lines: 200`, to fetch the run output.
   - If the run is still in progress, wait and poll logs again.

5. Summarize the result:
   - What the agent did (key actions, commits, API calls)
   - Whether it succeeded or failed
   - Any warnings or errors
