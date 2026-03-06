
Run agents like infrastructure. Versioned, deployable, repeatable.

First define a playbook for an agent:

```dev/PLAYBOOK.md
You are a developer. Your job is to pick up GitHub issues and implement the requested changes.

1. **Claim the issue** — run `gh issue edit <number> --repo <repo> --add-label in-progress` to mark it as claimed.

2. **Clone and branch** — run `git clone https://github.com/<repo>.git /workspace/repo && cd /workspace/repo && git checkout -b agent/<number>`.

... 

9. **Create a PR** — run `gh pr create --repo <repo> --head agent/<number> --base main --title "<title>" --body "Closes #<number>\n\n<description>"`.

10. **Comment on the issue** — run `gh issue comment <number> --repo <repo> --body "PR created: <pr_url>"`.

11. **Mark done** — run `gh issue edit <number> --repo <repo> --remove-label in-progress --add-label agent-completed`.
```

Now configure what credentials it needs:

```dev/agent-config.toml
credentials = ["github_token:default", "git_ssh:default"]
repos = ["Action-Llama/Action-Llama"]
schedule = "*/5 * * * *"
```

Run the agent locally:

```bash
# Run in project root.  it will prompt you for required credentials then start the scheduler.
$ al start
```
