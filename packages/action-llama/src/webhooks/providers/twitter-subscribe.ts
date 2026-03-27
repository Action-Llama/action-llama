/**
 * Twitter Account Activity API v2 auto-subscribe.
 *
 * On gateway startup, checks if a webhook URL is registered and the bot user
 * is subscribed. Warns if no webhook URL exists; subscribes if needed.
 *
 * Uses OAuth 2.0 user tokens for subscription management (per API reference).
 * Uses app-only Bearer token for webhook listing.
 */

import type { Logger } from "../../shared/logger.js";
import { writeCredentialField } from "../../shared/credentials.js";

export interface TwitterSubscribeOpts {
  bearerToken: string;
  oauth2AccessToken: string;
  oauth2RefreshToken: string;
  oauth2ClientId: string;
  oauth2ClientSecret: string;
  /** Credential instance name for persisting refreshed tokens */
  credentialInstance: string;
  logger: Logger;
}

const TOKEN_URL = "https://api.x.com/2/oauth2/token";

/**
 * Refresh the OAuth 2.0 access token using the refresh token.
 * Returns the new access token and refresh token, and persists them to disk.
 */
async function refreshOAuth2Token(opts: TwitterSubscribeOpts): Promise<{ accessToken: string; refreshToken: string } | null> {
  const { oauth2ClientId, oauth2ClientSecret, oauth2RefreshToken, credentialInstance, logger } = opts;

  if (!oauth2RefreshToken) {
    logger.warn("no OAuth 2.0 refresh token available — cannot refresh access token");
    return null;
  }

  const basicAuth = Buffer.from(`${oauth2ClientId}:${oauth2ClientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: oauth2RefreshToken,
      client_id: oauth2ClientId,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    logger.warn({ status: res.status, body }, "failed to refresh OAuth 2.0 token");
    return null;
  }

  const data = (await res.json()) as { access_token?: string; refresh_token?: string };
  if (!data.access_token) {
    logger.warn("refresh response missing access_token");
    return null;
  }

  // Persist new tokens to disk
  try {
    await writeCredentialField("x_twitter_user_oauth2", credentialInstance, "access_token", data.access_token);
    if (data.refresh_token) {
      await writeCredentialField("x_twitter_user_oauth2", credentialInstance, "refresh_token", data.refresh_token);
    }
    logger.info("refreshed and persisted OAuth 2.0 tokens");
  } catch (err) {
    logger.warn({ err }, "refreshed OAuth 2.0 token but failed to persist — token will expire");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? oauth2RefreshToken,
  };
}

/**
 * Make an authenticated request with OAuth 2.0 user token, retrying once with
 * a refreshed token on 401.
 */
async function oauth2Fetch(
  url: string,
  method: string,
  opts: TwitterSubscribeOpts,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${opts.oauth2AccessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (res.status === 401) {
    opts.logger.info("OAuth 2.0 access token expired, attempting refresh...");
    const refreshed = await refreshOAuth2Token(opts);
    if (refreshed) {
      opts.oauth2AccessToken = refreshed.accessToken;
      opts.oauth2RefreshToken = refreshed.refreshToken;
      return fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${refreshed.accessToken}`,
          "Content-Type": "application/json",
        },
      });
    }
  }

  return res;
}

/**
 * Check webhook registration and auto-subscribe the bot user.
 * Never throws — all errors are logged as warnings.
 */
export async function twitterAutoSubscribe(opts: TwitterSubscribeOpts): Promise<void> {
  const { logger, bearerToken } = opts;

  // Step 1: List webhooks to find webhook_id (uses app-only Bearer Token)
  let webhookId: string | undefined;
  try {
    const listUrl = "https://api.x.com/2/webhooks";
    const res = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });

    if (!res.ok) {
      const body = await res.text();
      logger.warn({ status: res.status, body }, "failed to check Twitter webhook registration");
      return;
    }

    const data = (await res.json()) as { data?: Array<{ id: string; url: string; valid: boolean }> };
    const webhooks = data.data ?? [];

    if (webhooks.length === 0) {
      logger.warn("no webhook URL registered with Twitter — register one in the X Developer Portal or via the API");
      return;
    }

    const webhook = webhooks[0];
    webhookId = webhook.id;
    logger.info({ webhookId, url: webhook.url, valid: webhook.valid }, "Twitter webhook URL registered");

    if (!webhook.valid) {
      logger.warn({ url: webhook.url }, "Twitter webhook URL is marked as invalid — CRC challenge may be failing");
    }
  } catch (err) {
    logger.warn({ err }, "failed to check Twitter webhook registration");
    return;
  }

  // Step 2: Check if bot user is already subscribed (uses OAuth 2.0 user token)
  try {
    const subUrl = `https://api.x.com/2/account_activity/webhooks/${webhookId}/subscriptions/all`;
    const res = await oauth2Fetch(subUrl, "GET", opts);

    if (res.ok) {
      const body = (await res.json()) as { data?: { subscribed?: boolean } };
      if (body.data?.subscribed) {
        logger.info("Twitter bot user already subscribed to Account Activity API");
        return;
      }
    }
    // Not subscribed or error — proceed to subscribe
  } catch (err) {
    logger.warn({ err }, "failed to check Twitter subscription status");
    // Proceed to attempt subscribe anyway
  }

  // Step 3: Subscribe bot user (uses OAuth 2.0 user token)
  try {
    const subUrl = `https://api.x.com/2/account_activity/webhooks/${webhookId}/subscriptions/all`;
    const res = await oauth2Fetch(subUrl, "POST", opts);

    if (res.ok) {
      logger.info("Twitter bot user subscribed to Account Activity API");
    } else {
      const body = await res.text();
      logger.warn({ status: res.status, body }, "failed to subscribe Twitter bot user to Account Activity API");
    }
  } catch (err) {
    logger.warn({ err }, "failed to subscribe Twitter bot user");
  }
}
