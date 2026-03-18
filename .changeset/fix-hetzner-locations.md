---
"@action-llama/action-llama": patch
---

Fixed Hetzner provisioning always showing "This server type is not available in
any location." The code checked a non-existent `available_locations` field on
the API response. Location availability is now derived from the `prices` array,
which lists per-location pricing for every location where the server type can
be provisioned.
