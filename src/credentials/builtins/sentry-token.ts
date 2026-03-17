import type { CredentialDefinition, CredentialPromptResult } from "../schema.js";
import { password, select, checkbox, confirm } from "@inquirer/prompts";
import { validateSentryToken, validateSentryProjects } from "../../setup/validators.js";
import { CREDENTIALS_DIR } from "../../shared/paths.js";

const sentryToken: CredentialDefinition = {
  id: "sentry_token",
  label: "Sentry Auth Token",
  description: "For error monitoring integration",
  helpUrl: "https://sentry.io/settings/auth-tokens/",
  fields: [
    { name: "token", label: "Auth Token", description: "Sentry auth token", secret: true },
  ],
  envVars: { token: "SENTRY_AUTH_TOKEN" },
  agentContext: "`SENTRY_AUTH_TOKEN` — use `curl` for Sentry API requests",

  // Custom prompt: validate → pick org → pick projects → return linked params
  async prompt(existing) {
    let token: string | undefined;

    if (existing?.token) {
      const reuse = await confirm({
        message: `Found existing Sentry token in ${CREDENTIALS_DIR}/sentry_token/. Use it?`,
        default: true,
      });
      if (reuse) {
        token = existing.token;
      }
    }

    if (!token) {
      const useSentry = await confirm({
        message: "Configure Sentry integration?",
        default: false,
      });
      if (!useSentry) return undefined;

      token = (await password({
        message: "Sentry auth token:",
        mask: "*",
        validate: (v) => (v.trim().length > 0 ? true : "Token is required"),
      })).trim();
    }

    console.log("Validating Sentry token...");
    const { organizations } = await validateSentryToken(token);
    if (organizations.length === 0) throw new Error("No organizations found");

    let sentryOrg: string;
    if (organizations.length === 1) {
      sentryOrg = organizations[0].slug;
      console.log(`Organization: ${sentryOrg}\n`);
    } else {
      sentryOrg = await select({
        message: "Select Sentry organization:",
        choices: organizations.map((o) => ({ name: `${o.name} (${o.slug})`, value: o.slug })),
      });
    }

    let sentryProjectSlugs: string[] = [];
    const { projects } = await validateSentryProjects(token, sentryOrg);
    if (projects.length > 0) {
      sentryProjectSlugs = await checkbox({
        message: "Select Sentry projects to monitor:",
        choices: projects.map((p) => ({ name: p.name, value: p.slug })),
      });
    }

    return {
      values: { token },
      params: {
        sentryOrg,
        sentryProjects: sentryProjectSlugs,
      },
    };
  },
};

export default sentryToken;
