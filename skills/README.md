# Agent Skills Reference

These docs are for **LLMs running as Action Llama agents**. They describe the runtime capabilities available to you during a run.

Skills are organized by category:

| Skill | What it covers |
|-------|---------------|
| [Credentials](credentials.md) | Environment variables, tools, and access patterns available from mounted credentials |
| [Signals](signals.md) | Text signals you emit in your output to communicate with the scheduler |
| [Resource Locks](resource-locks.md) | `rlock`/`runlock`/`rlock-heartbeat` for coordinating parallel instances |
| [Environment](environment.md) | How to determine your trigger type and where to find context variables |

You do not need to memorize the underlying mechanics (curl commands, env var names). Your prompt includes the details at runtime. These docs help you understand what each skill does and when to use it.
