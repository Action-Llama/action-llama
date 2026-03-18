# Cloud

Running `al start` on your laptop works for development, but for production you want agents running 24/7 on managed infrastructure — no laptop required, automatic restarts, and IAM-enforced secret isolation so a compromised agent can only access its own credentials.

Action Llama supports three cloud providers. All use the same project structure and agent configs — the only difference is the `[cloud]` section in `config.toml`.

## Quick start

```bash
al setup cloud -p .   # Interactive wizard: pick provider, configure, push creds, provision IAM
al start -c -p .     # Start on cloud
```

## Providers

### GCP (Cloud Run Jobs)

Agents run as serverless Cloud Run Jobs. Images are built with Cloud Build (no local Docker needed). Credentials are stored in Google Secret Manager and mounted as files natively by Cloud Run.

```toml
[cloud]
provider = "cloud-run"
gcpProject = "my-gcp-project"
region = "us-central1"
artifactRegistry = "us-central1-docker.pkg.dev/my-gcp-project/al-images"
serviceAccount = "al-runner@my-gcp-project.iam.gserviceaccount.com"
```

```bash
al doctor -c    # Push creds + create per-agent service accounts
al start -c     # Start on Cloud Run
```

If you add a new agent later, re-run `al doctor -c` to create its service account and IAM bindings.

See [Cloud Run docs](cloud-run.md) for prerequisites, full setup walkthrough, and troubleshooting.

### AWS (ECS Fargate)

Agents run as ECS Fargate tasks. Images are built locally and pushed to ECR. Credentials are stored in AWS Secrets Manager and injected as environment variables by ECS.

```toml
[cloud]
provider = "ecs"
awsRegion = "us-east-1"
ecsCluster = "al-cluster"
ecrRepository = "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images"
executionRoleArn = "arn:aws:iam::123456789012:role/ecsTaskExecutionRole"
taskRoleArn = "arn:aws:iam::123456789012:role/al-default-task-role"
subnets = ["subnet-abc123"]
```

```bash
al doctor -c    # Push creds + create per-agent IAM task roles
al start -c     # Start on ECS Fargate
```

If you add a new agent later, re-run `al doctor -c` to create its task role and IAM policy.

See [ECS docs](ecs.md) for prerequisites, full setup walkthrough, and troubleshooting.

### VPS (SSH + Docker)

Agents run on any VPS or server you can SSH into. Images are built directly on the server via `tar | ssh docker build` — no container registry needed. Credentials are stored on the VPS filesystem over SSH.

```toml
[cloud]
provider = "vps"
host = "your-vps-ip"
```

```bash
al doctor -c    # Push creds to VPS via SSH
al start -c     # Start on VPS
```

Setup supports three paths:
- **Connect to an existing server** — any provider, any server with Docker installed
- **Provision a new Vultr VPS** — automated instance creation with cloud-init Docker install
- **Provision a new Hetzner VPS** — automated server creation with cloud-init Docker install

See [VPS docs](vps-deployment.md) for full setup.

## Provider comparison

| | GCP Cloud Run | AWS ECS (Fargate + Lambda) | VPS (SSH + Docker) |
|---|---|---|---|
| Image builds | Cloud Build (no local Docker) | CodeBuild (no local Docker) | `tar \| ssh docker build` (on VPS) |
| Credential store | Google Secret Manager | AWS Secrets Manager | Filesystem on VPS (over SSH) |
| Credential delivery | File mount (native) | Env var injection | Volume mount |
| Secret isolation | Per-agent service accounts | Per-agent IAM task/Lambda roles | SSH access = full access |
| Setup command | `al doctor -c` | `al doctor -c` | `al doctor -c` |
| Log latency | ~5-15s (Cloud Logging) | ~5-10s (CloudWatch) | Real-time (SSH) |
| Cold start | ~10-30s | ~1-2s (Lambda, timeout<=900s) / ~30-60s (Fargate) | ~1-2s |
| Cost | Pay-per-run | Pay-per-run | Fixed monthly ($5-24/mo) |
| IAM reconciliation | Per-agent service accounts | Per-agent IAM roles | No-op |

On AWS, agents with `timeout <= 900` automatically route to Lambda for faster cold starts. Agents with longer timeouts use ECS Fargate. See [ECS docs](ecs.md#per-agent-timeout-and-lambda-routing) for details.
