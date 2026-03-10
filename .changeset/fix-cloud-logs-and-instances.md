---
"@action-llama/action-llama": patch
---

Fixed `al logs -c` for ECS agents failing with "Cannot order by LastEventTime with a logStreamNamePrefix" by replacing the DescribeLogStreams-based tail with FilterLogEvents. Cloud logs now render through the same conversation/raw formatter as local logs, and Lambda platform lines (START, END, REPORT) are filtered out. Added `--instance` flag to `al logs` for agents with `scale > 1` — in follow mode, lists running instances and lets you pick one; in local mode, targets a specific instance's log file. Fixed local Docker `fetchLogs` to aggregate logs across all containers for the same agent.
