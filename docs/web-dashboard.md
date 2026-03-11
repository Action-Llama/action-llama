# Web Dashboard

Action Llama includes an optional web-based dashboard for monitoring agents in your browser. It provides a live view of agent statuses and streaming logs — similar to the terminal TUI, but accessible from any browser.

## Enabling the Dashboard

Pass `-w` or `--web-ui` to `al start`:

```bash
al start -w
al start -w -p ./my-project
```

The dashboard URL is shown in the TUI header and in headless log output once the scheduler starts:

```
Dashboard: http://localhost:8080/dashboard
```

The port is controlled by the `[gateway].port` setting in `config.toml` (default: `8080`).

## Authentication

Set the `AL_DASHBOARD_SECRET` environment variable to enable HTTP basic auth on all dashboard routes:

```bash
AL_DASHBOARD_SECRET=my-secret al start -w
```

When set, the browser will prompt for credentials. Use any username and the secret as the password. When not set, the dashboard is open (suitable for local development).

Only the `/dashboard` routes are protected — health checks, webhook endpoints, and container management routes are unaffected.

## Dashboard Pages

### Main Page — `/dashboard`

Displays a live overview of all agents:

| Column | Description |
|--------|-------------|
| Agent | Agent name (click to view logs) |
| State | Current state: idle, running, building, or error |
| Status | Latest status text or error message |
| Last Run | Timestamp of the most recent run |
| Duration | How long the last run took |
| Next Run | When the next scheduled run will happen |

Below the table, a **Recent Activity** section shows the last 20 log lines across all agents.

All data updates in real time via Server-Sent Events (SSE) — no manual refresh needed.

### Agent Logs — `/dashboard/agents/<name>/logs`

Displays a live-streaming log view for a single agent. Logs follow automatically by default (new entries scroll into view as they arrive).

Features:
- **Follow mode** — enabled by default, auto-scrolls to the latest log entry. Scrolling up pauses follow; scrolling back to the bottom re-enables it.
- **Clear** — clears the log display (does not delete log files).
- **Connection status** — shows whether the SSE connection is active.
- **Log levels** — color-coded: green for INFO, yellow for WARN, red for ERROR.

On initial load, the last 100 log entries from the agent's log file are displayed, then new entries stream in as they are written.

## How It Works

The dashboard is served by the same gateway that handles webhooks and container communication. When `--web-ui` is enabled, the gateway starts even if Docker and webhooks are not configured.

Live updates use **Server-Sent Events (SSE)** on two endpoints:

- `GET /dashboard/api/status-stream` — pushes agent status and scheduler info whenever state changes
- `GET /dashboard/api/logs/<agent>/stream` — streams log lines for a specific agent by tailing its log file (500ms poll interval)

No additional dependencies or frontend build steps are required. The dashboard is rendered as plain HTML with inline CSS and JavaScript.
