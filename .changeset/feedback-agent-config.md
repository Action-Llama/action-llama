---
"@action-llama/action-llama": minor
---

Add feedback agent configuration system that automatically triggers agents to fix errors found in other agents' logs, with the ability to update their SKILL.md files.

Features:
- **Global feedback configuration** in project config with enabled/disabled toggle, error patterns, context lines, and custom feedback agent selection
- **Per-agent feedback overrides** to enable/disable feedback for specific agents independently of global settings  
- **Built-in default feedback agent** that conservatively fixes only syntax errors and formatting issues while preserving original agent intent
- **Automatic log monitoring** that detects error patterns in agent logs and triggers feedback agents with relevant context
- **SKILL.md validation and backup** when feedback agents make corrections
- **CLI configuration** via `al agent config` command with feedback override options
- **Web UI configuration** with project-wide feedback settings and per-agent toggles
- **Conservative approach** - feedback agents only fix clear technical issues, never alter agent behavior or functionality

The feedback system helps maintain agent health by automatically detecting and fixing common SKILL.md syntax errors, YAML formatting issues, and obvious typos that can cause agent failures.

Closes #213