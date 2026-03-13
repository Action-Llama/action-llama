# Models

Action Llama supports 8 LLM providers. Each agent can use a different provider and model — configure a project-wide default in `config.toml` under `[model]`, and override per agent in `agent-config.toml`.

## `[model]` Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | string | Yes | Provider name (see table below) |
| `model` | string | Yes | Model ID |
| `authType` | string | Yes | `"api_key"`, `"oauth_token"`, or `"pi_auth"` |
| `thinkingLevel` | string | No | Reasoning budget (Anthropic only) |

## Providers

### Anthropic

Claude models with optional extended thinking.

```toml
[model]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
thinkingLevel = "medium"
authType = "api_key"
```

| Model | Description |
|-------|-------------|
| `claude-opus-4-20250514` | Most capable, best for complex multi-step tasks |
| `claude-sonnet-4-20250514` | Balanced performance and cost (recommended) |
| `claude-haiku-3-5-20241022` | Fastest and cheapest |

**Credential:** `anthropic_key` (field: `token`)

**Auth types:**

| `authType` | Token format | Description |
|------------|-------------|-------------|
| `api_key` | `sk-ant-api-...` | Standard Anthropic API key |
| `oauth_token` | `sk-ant-oat-...` | OAuth token from `claude setup-token` |
| `pi_auth` | _(none)_ | Uses existing pi auth credentials (`~/.pi/agent/auth.json`). No credential file needed. |

**Note:** `pi_auth` is not supported in Docker mode. Switch to `api_key` or `oauth_token` for containerized runs.

**Thinking level:** Anthropic is the only provider that supports `thinkingLevel`. Valid values:

| Level | Description |
|-------|-------------|
| `off` | No extended thinking |
| `minimal` | Minimal reasoning |
| `low` | Light reasoning |
| `medium` | Balanced (recommended) |
| `high` | Deep reasoning |
| `xhigh` | Maximum reasoning budget |

If omitted, thinking is not explicitly configured. For other providers, `thinkingLevel` is ignored.

### OpenAI

```toml
[model]
provider = "openai"
model = "gpt-4o"
authType = "api_key"
```

| Model | Description |
|-------|-------------|
| `gpt-4o` | Flagship multimodal model (recommended) |
| `gpt-4o-mini` | Smaller, faster, cheaper |
| `gpt-4-turbo` | Previous generation |
| `o1-preview` | Reasoning model |
| `o1-mini` | Smaller reasoning model |

**Credential:** `openai_key` (field: `token`)

### Groq

```toml
[model]
provider = "groq"
model = "llama-3.3-70b-versatile"
authType = "api_key"
```

| Model | Description |
|-------|-------------|
| `llama-3.3-70b-versatile` | Llama 3.3 70B on Groq inference |

Groq runs open-source models at high speed. Check [Groq's docs](https://console.groq.com/docs/models) for the full list of available model IDs.

**Credential:** `groq_key` (field: `token`)

### Google Gemini

```toml
[model]
provider = "google"
model = "gemini-2.0-flash-exp"
authType = "api_key"
```

| Model | Description |
|-------|-------------|
| `gemini-2.0-flash-exp` | Fast experimental model |

Check [Google AI Studio](https://ai.google.dev/models) for the full list of available model IDs.

**Credential:** `google_key` (field: `token`)

### xAI

```toml
[model]
provider = "xai"
model = "grok-beta"
authType = "api_key"
```

| Model | Description |
|-------|-------------|
| `grok-beta` | Grok beta |

**Credential:** `xai_key` (field: `token`)

### Mistral

```toml
[model]
provider = "mistral"
model = "mistral-large-2411"
authType = "api_key"
```

| Model | Description |
|-------|-------------|
| `mistral-large-2411` | Mistral Large (November 2024) |

Check [Mistral's docs](https://docs.mistral.ai/getting-started/models/) for the full list of available model IDs.

**Credential:** `mistral_key` (field: `token`)

### OpenRouter

OpenRouter provides access to models from many providers through a single API.

```toml
[model]
provider = "openrouter"
model = "anthropic/claude-3.5-sonnet"
authType = "api_key"
```

Model IDs use the `provider/model` format. See [OpenRouter's model list](https://openrouter.ai/models) for all available models.

**Credential:** `openrouter_key` (field: `token`)

### Custom

For any provider not listed above. The model ID and API routing are handled by the underlying [pi.dev agent harness](https://github.com/badlogic/pi-mono).

```toml
[model]
provider = "custom"
model = "your-model-name"
authType = "api_key"
```

**Credential:** `custom_key` (field: `token`)

## Mixing Models

Each agent can use a different model. Define a project default in `config.toml`, then override in specific agents:

```
config.toml          → [model] provider = "anthropic", model = "claude-sonnet-4-20250514"
dev/agent-config.toml     → (no [model] section — inherits Claude Sonnet)
reviewer/agent-config.toml → [model] provider = "openai", model = "gpt-4o"
devops/agent-config.toml   → [model] provider = "groq", model = "llama-3.3-70b-versatile"
```

If an agent defines its own `[model]` section, it fully overrides the project default — there is no field-level merging.

## Credential Setup

Each provider requires a corresponding credential in `~/.action-llama/credentials/`. Run `al doctor` to configure them interactively.

The LLM credential does not need to be listed in your agent's `credentials` array — it is loaded automatically based on the `[model]` config. The `credentials` array is for runtime credentials the agent uses during execution (GitHub tokens, SSH keys, etc.).

See [Credentials](credentials.md) for the full credential reference.
