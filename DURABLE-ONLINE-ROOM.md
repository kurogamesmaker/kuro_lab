# KURO Durable Online Room migration

## Status
- Durable Objects room Worker source and Wrangler config are present.
- SDK has an opt-in WebSocket adapter.
- Existing polling remains the default and fallback.
- Durable Objects deployment and multiplayer verification are NOT completed.

## Deploy gate
GitHub Actions workflow `.github/workflows/deploy-online-room.yml` is manual-only and requires repository variable `DEPLOY_DURABLE_OBJECTS=true` plus secrets `CF_API_TOKEN` and `CF_ACCOUNT_ID`. The token needs Workers Scripts edit permission. Do not enable the gate until the Worker has been reviewed and authentication is implemented.


## SDK opt-in
Set `window.KuroGamesDurableEndpoint` to the Worker HTTPS origin (the exact workers.dev origin confirmed after deployment). The SDK converts it to WebSocket and connects at `/room/{roomId}`. Leave it unset to keep polling.


## Production blocker / security
The prototype currently does not verify the KURO/Supabase access token or enforce a trusted identity. Client-provided player IDs are spoofable. Do NOT expose or deploy it for production gameplay until server-side JWT validation (issuer/audience/signature/expiry) or another strong authentication gate is added, plus message schema/rate limits, disconnect cleanup, room membership enforcement, and multi-client tests.


## Migration order
1. Secure Worker authentication and room membership.
2. Deploy via the gated GitHub Actions workflow.
3. Confirm Worker URL and health endpoint.
4. Set SDK endpoint in the host page and test two separate clients.
5. Verify room create/join, player list, event send/receive, leave/reconnect, state updates.
6. Move room create/join/state HTTP actions to Worker/DO only after protocol and server validation are implemented.
7. Remove polling fallback only after production verification.
