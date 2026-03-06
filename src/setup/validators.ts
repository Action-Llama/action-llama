export async function validateGitHubToken(token: string) {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };

  const userRes = await fetch("https://api.github.com/user", { headers });
  if (!userRes.ok) throw new Error(`GitHub auth failed: ${userRes.status}`);
  const user = (await userRes.json()) as { login: string };

  const reposRes = await fetch("https://api.github.com/user/repos?sort=updated&per_page=100", { headers });
  if (!reposRes.ok) throw new Error(`GitHub repos fetch failed: ${reposRes.status}`);
  const repos = (await reposRes.json()) as Array<{ owner: { login: string }; name: string; full_name: string }>;

  return {
    user: user.login,
    repos: repos.map((r) => ({ owner: r.owner.login, repo: r.name, fullName: r.full_name })),
  };
}

export async function validateSentryToken(token: string) {
  const res = await fetch("https://sentry.io/api/0/organizations/", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Sentry auth failed: ${res.status}`);
  const orgs = (await res.json()) as Array<{ slug: string; name: string }>;
  return { organizations: orgs };
}

export async function validateSentryProjects(token: string, org: string) {
  const res = await fetch(`https://sentry.io/api/0/organizations/${org}/projects/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Sentry projects fetch failed: ${res.status}`);
  const projects = (await res.json()) as Array<{ slug: string; name: string }>;
  return { projects };
}

export async function validateAnthropicApiKey(key: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 10,
      messages: [{ role: "user", content: "Hi" }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API key validation failed (${res.status}): ${body}`);
  }
  return true;
}

export function validateOAuthTokenFormat(token: string) {
  if (!token.includes("sk-ant-oat")) {
    throw new Error(
      "Token does not look like an Anthropic OAuth token (expected sk-ant-oat* prefix). " +
      "If you have an API key, choose the API key option instead."
    );
  }
  return true;
}

export async function validateNetlifyToken(token: string) {
  const res = await fetch("https://api.netlify.com/api/v1/user", {
    headers: { 
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
  });
  
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Netlify auth failed (${res.status}): ${body}`);
  }
  
  const user = (await res.json()) as { email: string; full_name?: string };
  
  return {
    user: user.email,
    fullName: user.full_name,
  };
}
