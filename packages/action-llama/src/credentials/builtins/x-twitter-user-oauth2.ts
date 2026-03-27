import { createHash, randomBytes } from "crypto";
import { createServer } from "http";
import type { CredentialDefinition } from "../schema.js";
import { password, confirm } from "@inquirer/prompts";

/** Scopes required for Account Activity API subscriptions and DMs */
const OAUTH2_SCOPES = "dm.read dm.write tweet.read users.read offline.access";

const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
/** Fixed port for the OAuth callback server — must match the redirect URI registered in the X console */
const CALLBACK_PORT = 3829;
const CALLBACK_URI = `http://localhost:${CALLBACK_PORT}/callback`;

/**
 * Run the OAuth 2.0 PKCE flow by starting a temporary local HTTP server,
 * opening the browser for user authorization, and exchanging the code for tokens.
 */
async function runPkceFlow(clientId: string, clientSecret: string): Promise<{ accessToken: string; refreshToken: string }> {
  // Generate PKCE code verifier and challenge
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const state = randomBytes(16).toString("hex");

  return new Promise((resolve, reject) => {
    const connections = new Set<import("net").Socket>();
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Authorization failed</h2><p>You can close this tab.</p></body></html>");
        shutdown();
        reject(new Error(`OAuth 2.0 authorization error: ${error}`));
        return;
      }

      if (!code || returnedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Invalid callback</h2><p>Missing code or state mismatch.</p></body></html>");
        shutdown();
        reject(new Error("OAuth 2.0 callback: missing code or state mismatch"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body><h2>Authorization successful!</h2><p>You can close this tab and return to the terminal.</p></body></html>");

      // Exchange authorization code for tokens (30-second deadline)
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: CALLBACK_URI,
          code_verifier: codeVerifier,
        }),
      })
        .then(async (tokenRes) => {
          if (!tokenRes.ok) {
            const body = await tokenRes.text();
            throw new Error(`Token exchange failed (${tokenRes.status}): ${body}`);
          }
          return tokenRes.json();
        })
        .then((data: any) => {
          shutdown();
          if (!data.access_token) {
            reject(new Error("Token exchange response missing access_token"));
            return;
          }
          resolve({
            accessToken: data.access_token,
            refreshToken: data.refresh_token ?? "",
          });
        })
        .catch((err) => {
          shutdown();
          reject(err);
        });
    });

    server.on("connection", (sock) => {
      connections.add(sock);
      sock.on("close", () => connections.delete(sock));
    });

    function shutdown() {
      for (const sock of connections) sock.destroy();
      server.close();
    }

    server.listen(CALLBACK_PORT, "127.0.0.1", () => {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: CALLBACK_URI,
        scope: OAUTH2_SCOPES,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });

      const authUrl = `${AUTHORIZE_URL}?${params}`;
      console.log(`\n  Opening browser for X authorization...`);
      console.log(`  If it doesn't open, visit:\n  ${authUrl}\n`);

      // Open browser (best-effort)
      import("child_process").then(({ exec }) => {
        const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        exec(`${cmd} "${authUrl}"`);
      });
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      shutdown();
      reject(new Error("OAuth 2.0 authorization timed out (2 minutes)"));
    }, 120_000);
  });
}

/** Validate the access token by calling the /2/users/me endpoint */
async function validateAccessToken(accessToken: string): Promise<void> {
  const res = await fetch("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X OAuth 2.0 token validation failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { data?: { username?: string } };
  if (data.data?.username) {
    console.log(`  Authenticated as @${data.data.username}`);
  }
}

const xTwitterUserOauth2: CredentialDefinition = {
  id: "x_twitter_user_oauth2",
  label: "X (Twitter) User OAuth 2.0 Credentials",
  description: "OAuth 2.0 PKCE credentials for user-context authentication (DMs, tweets, Account Activity subscriptions)",
  helpUrl: "https://developer.x.com/en/portal/dashboard",
  fields: [
    { name: "client_id", label: "Client ID", description: "OAuth 2.0 Client ID from the 'Keys and tokens' tab in the X Developer Portal", secret: true },
    { name: "client_secret", label: "Client Secret", description: "OAuth 2.0 Client Secret from the 'Keys and tokens' tab in the X Developer Portal", secret: true },
    { name: "access_token", label: "Access Token", description: "OAuth 2.0 user access token (obtained via PKCE flow)", secret: true },
    { name: "refresh_token", label: "Refresh Token", description: "OAuth 2.0 refresh token for obtaining new access tokens", secret: true },
  ],
  envVars: {
    client_id: "X_OAUTH2_CLIENT_ID",
    client_secret: "X_OAUTH2_CLIENT_SECRET",
    access_token: "X_OAUTH2_ACCESS_TOKEN",
    refresh_token: "X_OAUTH2_REFRESH_TOKEN",
  },
  agentContext: "`X_OAUTH2_ACCESS_TOKEN`, `X_OAUTH2_REFRESH_TOKEN`, `X_OAUTH2_CLIENT_ID`, `X_OAUTH2_CLIENT_SECRET` — OAuth 2.0 user-context auth for X API v2 (DMs, tweets, Account Activity subscriptions)",

  async prompt(existing) {
    if (existing?.access_token && existing?.client_id) {
      const reuse = await confirm({
        message: "Found existing X OAuth 2.0 credentials. Use them?",
        default: true,
      });
      if (reuse) return { values: existing };
    }

    console.log(`\n  X (Twitter) User OAuth 2.0 Credentials`);
    console.log(`  OAuth 2.0 PKCE flow for user-context auth (DMs, Account Activity subscriptions)`);
    console.log(`  → https://developer.x.com/en/portal/dashboard\n`);
    console.log(`  Add this exact Callback URI in your app's OAuth 2.0 settings:`);
    console.log(`  ${CALLBACK_URI}\n`);

    const clientId = await password({
      message: "X OAuth 2.0 — Client ID:",
      mask: "*",
      validate: (v: string) => (v.trim().length > 0 ? true : "Client ID is required"),
    });

    const clientSecret = await password({
      message: "X OAuth 2.0 — Client Secret:",
      mask: "*",
      validate: (v: string) => (v.trim().length > 0 ? true : "Client Secret is required"),
    });

    console.log(`\n  Starting OAuth 2.0 PKCE flow to obtain user access token...`);
    console.log(`  Requested scopes: ${OAUTH2_SCOPES}\n`);

    const { accessToken, refreshToken } = await runPkceFlow(clientId.trim(), clientSecret.trim());

    return {
      values: {
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
        access_token: accessToken,
        refresh_token: refreshToken,
      },
    };
  },

  async validate(values) {
    await validateAccessToken(values.access_token);
    return true;
  },
};

export default xTwitterUserOauth2;
