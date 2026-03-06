# Cloud Run Mode

Run agents as Cloud Run Jobs on GCP instead of local Docker containers. Agents get the same isolation guarantees with the added benefits of serverless scaling, managed infrastructure, and per-agent secret isolation via IAM.

## Prerequisites

- GCP project with Cloud Run, Secret Manager, Artifact Registry, and Cloud Build APIs enabled
- `gcloud` CLI authenticated (`gcloud auth login`)
- Credentials pushed to Google Secret Manager (`al creds push <remote>`)

Local Docker is **not required** — images are built using Cloud Build.

## Configuration

In your project's `config.toml`:

```toml
[docker]
enabled = true
runtime = "cloud-run"
gcpProject = "my-gcp-project"
region = "us-central1"
artifactRegistry = "us-central1-docker.pkg.dev/my-gcp-project/al-images"
serviceAccount = "al-runner@my-gcp-project.iam.gserviceaccount.com"
# secretPrefix = "action-llama"   # optional, default: "action-llama"
```

| Key | Required | Description |
|-----|----------|-------------|
| `docker.runtime` | Yes | Set to `"cloud-run"` |
| `docker.gcpProject` | Yes | GCP project ID |
| `docker.region` | Yes | Cloud Run region (e.g. `us-central1`) |
| `docker.artifactRegistry` | Yes | Full Artifact Registry repo path |
| `docker.serviceAccount` | No | Runtime SA (for job creation). Per-agent SAs are used for job execution. |
| `docker.secretPrefix` | No | GSM secret name prefix (default: `"action-llama"`) |
| `docker.memory` | No | Memory per job (default: `"4Gi"`) |
| `docker.cpus` | No | CPUs per job (default: `2`) |
| `docker.timeout` | No | Max execution time in seconds (default: `3600`) |

## Setup

### 1. Enable GCP APIs

```bash
gcloud services enable \
  run.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  --project my-gcp-project
```

### 2. Create an Artifact Registry repository

```bash
gcloud artifacts repositories create al-images \
  --repository-format=docker \
  --location=us-central1 \
  --project my-gcp-project
```

### 3. Configure Docker for Artifact Registry

```bash
gcloud auth configure-docker us-central1-docker.pkg.dev
```

### 4. Push credentials to Secret Manager

If you haven't already set up a remote, add one and push:

```bash
al remote add production --provider gsm --gcp-project my-gcp-project -p .
al creds push production -p .
```

### 5. Create per-agent service accounts

```bash
al setup --cloud -p .
```

This creates a service account for each agent (`al-{agentName}@{project}.iam.gserviceaccount.com`) and grants it `secretmanager.secretAccessor` on only the secrets that agent needs. This ensures that a compromised agent container cannot access other agents' secrets.

### 6. Start

```bash
al start -p .
```

The scheduler will:
1. Build agent images locally
2. Push them to Artifact Registry
3. Create/update Cloud Run jobs with GSM secret volume mounts
4. Execute jobs on schedule or webhook trigger
5. Stream logs from Cloud Logging

## Cloud Build

When running in Cloud Run mode, images are built using [Cloud Build](https://cloud.google.com/build) instead of local Docker. This means you don't need Docker installed on your machine or CI server — Cloud Build handles building and pushing to Artifact Registry in one step.

Enable the Cloud Build API:

```bash
gcloud services enable cloudbuild.googleapis.com --project my-gcp-project
```

The scheduler automatically uses `gcloud builds submit` when `docker.runtime = "cloud-run"`. No additional configuration is needed.

If you prefer to build locally (e.g. for faster iteration), you can build and push manually, then start with the local runtime pointed at the same Artifact Registry. But for CI/CD and environments without Docker (Railway, etc.), Cloud Build is the recommended approach.

## How it works

### Image lifecycle

Images are built using Cloud Build and pushed to Artifact Registry. Each agent gets its own image tag (`al-{agentName}:latest`). The build happens on every `al start` to ensure the latest code is deployed. Cloud Build handles caching automatically.

### Secret mounting

Cloud Run mounts secrets from Google Secret Manager as files at `/credentials/<type>/<instance>/<field>` — the same layout as local Docker mode. The container entry point reads credentials from this path identically in both modes.

Secret names follow the convention: `{prefix}--{type}--{instance}--{field}` (e.g. `action-llama--github_token--default--token`).

### Per-agent service accounts

Each agent runs as its own GCP service account:

```
al-dev@my-project.iam.gserviceaccount.com      → github_token, git_ssh, anthropic_key
al-reviewer@my-project.iam.gserviceaccount.com  → github_token, git_ssh, anthropic_key
al-devops@my-project.iam.gserviceaccount.com    → github_token, sentry_token, anthropic_key
```

Each SA only has `secretmanager.secretAccessor` on its declared secrets. Even if an agent container is compromised and accesses the GCP metadata server to obtain the SA's token, it can only read its own secrets.

Run `al setup --cloud` to create these SAs and IAM bindings automatically.

### Gateway

The gateway is **not required** for Cloud Run mode. Containers get their credentials via native GSM mounts (not the gateway's HTTP endpoint), and Cloud Run handles execution timeouts natively (no kill switch needed). The gateway still starts if you have webhooks configured, since webhooks are received by the scheduler process.

### Log streaming

Logs are streamed from Cloud Logging by polling. There is a ~5-15 second ingestion delay inherent to Cloud Logging. The TUI displays a warning about this delay when running in Cloud Run mode.

## Comparison with local Docker

| Aspect | Local Docker | Cloud Run |
|--------|-------------|-----------|
| Where containers run | Your machine | GCP |
| Credential delivery | Volume mount from temp dir | GSM secret volume mount |
| Secret isolation | Mount-level (same trust boundary) | IAM-enforced per-agent SAs |
| Gateway needed | Yes (kill switch, cred serving) | No (optional for webhooks) |
| Log latency | Real-time | ~5-15s delay |
| Scaling | Limited by host resources | Serverless, managed |
| Cost | Free (your hardware) | Pay per execution |

## Troubleshooting

**"Cloud Run runtime requires docker.gcpProject..."** — Ensure all required fields are set in `config.toml` under `[docker]`.

**"Failed to get GCP access token"** — Run `gcloud auth application-default login` or set `GCP_SERVICE_ACCOUNT_KEY` env var.

**"Failed to push image"** — Run `gcloud auth configure-docker <region>-docker.pkg.dev` to configure Docker for Artifact Registry.

**"Failed to create Cloud Run job"** — Check that Cloud Run API is enabled and the runtime SA has `run.jobs.create` permission.

**Logs are delayed** — This is expected. Cloud Logging has a ~5-15 second ingestion delay. The TUI shows a warning when running in Cloud Run mode.

**Agent can't access secrets** — Run `al setup --cloud` to create per-agent SAs and IAM bindings. Verify with `gcloud secrets get-iam-policy <secret-name> --project <project>`.
