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

export async function validateAWSCredentials(accessKeyId: string, secretAccessKey: string, sessionToken?: string) {
  // Use AWS STS GetCallerIdentity to validate credentials
  const region = "us-east-1"; // STS is available in all regions, use us-east-1 as default
  const service = "sts";
  const action = "GetCallerIdentity";
  const host = `${service}.${region}.amazonaws.com`;
  const endpoint = `https://${host}/`;
  
  // Create AWS Signature Version 4
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const timestamp = now.toISOString().slice(0, 19).replace(/[-:]/g, "") + "Z";
  
  const params = "Action=GetCallerIdentity&Version=2011-06-15";
  const headers: Record<string, string> = {
    "Host": host,
    "X-Amz-Date": timestamp,
  };
  
  if (sessionToken) {
    headers["X-Amz-Security-Token"] = sessionToken;
  }
  
  // Create canonical request
  const headerNames = Object.keys(headers).map(h => h.toLowerCase()).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(key => `${key.toLowerCase()}:${headers[key]}\n`).join("");
  
  const canonicalRequest = `POST\n/\n${params}\n${canonicalHeaders}\n${headerNames}\npayload`;
  
  // Create string to sign
  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${await sha256(canonicalRequest)}`;
  
  // Create signing key
  const signingKey = await hmacSha256(
    await hmacSha256(
      await hmacSha256(
        await hmacSha256(`AWS4${secretAccessKey}`, dateStamp),
        region
      ),
      service
    ),
    "aws4_request"
  );
  
  // Create signature
  const signature = await hmacSha256(signingKey, stringToSign);
  const signatureHex = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  
  // Create authorization header
  const authHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${headerNames}, Signature=${signatureHex}`;
  headers["Authorization"] = authHeader;
  
  // Make the request
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: params + "&X-Amz-Content-Sha256=payload",
  });
  
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AWS credentials validation failed (${res.status}): ${body}`);
  }
  
  const responseText = await res.text();
  if (!responseText.includes("<GetCallerIdentityResponse")) {
    throw new Error("AWS credentials validation failed: Invalid response format");
  }
  
  return true;
}

async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key: string | ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyData = typeof key === 'string' ? encoder.encode(key) : key;
  const messageData = encoder.encode(message);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  return crypto.subtle.sign('HMAC', cryptoKey, messageData);
}
