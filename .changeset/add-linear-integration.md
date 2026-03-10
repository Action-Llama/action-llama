---
"@action-llama/action-llama": minor
---

Add Linear credentials and webhooks integration

This adds comprehensive Linear support to Action Llama:

**New credential types:**
- `linear_token` - Personal API token authentication 
- `linear_oauth` - OAuth2 authentication (client ID, secret, access/refresh tokens)
- `linear_webhook_secret` - Webhook signature validation secret

**New webhook provider:**
- `linear` webhook type for receiving Linear organization-level webhooks
- Support for issues and comment events with filtering by organization, labels, assignee, and author
- HMAC signature validation using Linear webhook secrets

**Features:**
- OAuth2 as the default authentication method with personal token fallback
- Organization-level webhook configuration
- Comprehensive filtering for Linear issues and comment events
- Full test coverage for both credential validation and webhook handling
- Complete documentation with setup guides and examples

This enables agents to authenticate with Linear workspaces and respond to Linear webhook events like issue creation, updates, and comments.