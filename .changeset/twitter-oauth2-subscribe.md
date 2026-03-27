---
"@action-llama/action-llama": patch
---

Split `x_twitter_user` credential into `x_twitter_user_oauth1` (OAuth 1.0a access tokens) and `x_twitter_user_oauth2` (OAuth 2.0 PKCE credentials with client ID, client secret, access token, and refresh token). The `al doctor` OAuth 2.0 flow runs an interactive PKCE authorization via a local callback server on port 3829.

Twitter Account Activity API subscription management now uses OAuth 2.0 user tokens per the API reference, with automatic token refresh on 401. Webhook listing continues to use app-only Bearer token.
