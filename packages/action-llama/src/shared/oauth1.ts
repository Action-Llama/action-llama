/**
 * Minimal OAuth 1.0a types (RFC 5849).
 * Used for Twitter Account Activity API calls that require user-context auth.
 */

export interface OAuth1Params {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}
