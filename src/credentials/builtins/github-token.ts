import type { CredentialDefinition } from "../schema.js";
import { validateGitHubToken } from "../../setup/validators.js";

const githubToken: CredentialDefinition = {
  id: "github-token",
  label: "GitHub Personal Access Token",
  description: "Needs repo and workflow scopes",
  helpUrl: "https://github.com/settings/tokens",
  filename: "github-token",
  fields: [
    { name: "token", label: "Token", description: "GitHub PAT (ghp_...)", secret: true },
  ],
  envVars: { token: "GITHUB_TOKEN" },
  agentContext: "`GITHUB_TOKEN` / `GH_TOKEN` — use `gh` CLI and `git` directly",

  async validate(values) {
    await validateGitHubToken(values.token);
    return true;
  },
};

export default githubToken;
