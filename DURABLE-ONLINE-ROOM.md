# KURO Durable Online Room

## Live deployment
- Worker: `kuro-online-room`
- Public endpoint: `https://kuro-online-room.kurogamesmaker.workers.dev`
- Health path: `/health`
- Durable Object class: `Room`
- Namespace ID: `9633b9fd379f4e0690c398d3933b8dcd`
- Namespace storage: SQLite
- Latest verified Cloudflare deployment: `87330b602d644c0b8f84ddcd32e0909e` (100% traffic)
- Secret binding configured: `TICKET_SECRET` (value is not stored in GitHub)

## Authentication policy

All online features require a signed-in KURO account authenticated by Supabase Auth. This applies uniformly to multiplayer room creation/joining, room lists, room events, online rankings, cloud saves, profile reads, and online settings. Offline and CPU gameplay remain available without an account.

- The browser and Studio preview pass only the current Supabase Auth access token to the KuroGames SDK.
- The `kurogames-online` Edge Function validates the token with `admin.auth.getUser`; two-part Cloudflare guest tokens and anonymous Supabase Auth sessions are rejected.
- The Worker issues connection tickets only after validating the Supabase account token and confirming room membership.
- Account connection tickets carry `typ: kuro_account`; the WebSocket endpoint rejects legacy guest tokens even if one was issued before this policy.
- The retired `/guest-token` and `/guest/verify` routes return HTTP 410 and never issue or validate guest credentials.
- Existing historical guest records are not deleted. Old room entries naturally expire; they cannot authenticate, create new rooms, or rejoin.

- Supabase Edge Function `kurogames-online`: deployed version 22 with account-only authorization.

## Runtime flow
1. The KuroGames SDK obtains the signed-in account session from the game player or Studio parent page.
2. The SDK calls the `kurogames-online` Edge Function with the Supabase access token.
3. The Edge Function validates the account, enforces published-game and feature settings, and authorizes room/ranking/save actions.
4. For Durable Objects WebSocket delivery, the Worker independently validates the Supabase access token and checks room membership.
5. The Worker signs a short-lived account-only connection ticket and forwards the WebSocket to the room's Durable Object.
6. The DO derives player identity from trusted Worker headers, never from client-supplied player IDs. It manages connection presence and broadcasts game events.
7. Room state get/update remain on the authenticated Edge Function API for backwards-compatible persistence and optimistic concurrency. The DO carries real-time notifications/events.

`get_config` remains readable before login so games can discover which online features are configured; every operation that reads or changes a player's online data requires a signed-in account.
## SDK behavior
- `game-studio/kurog-online.js` uses this Worker endpoint by default for multiplayer.
- `window.KuroGamesDurableEndpoint = ""` can temporarily disable DO and use the legacy polling transport.
- Transient ticket/transport failures fall back to the legacy polling implementation. Authentication, missing room membership, and full-room responses fail closed rather than bypassing the checks.
- Existing API shape remains `KuroGames.multiplayer.createRoom/joinRoom`, `room.getPlayers()`, `room.onPlayersChange()`, `room.onMessage()`, `room.send()`, `room.getState()`, `room.updateState()`, and `room.leave()`.

## Verification
- Cloudflare API confirmed the DO namespace exists and the latest Worker deployment has a 100% traffic allocation.
- Cloudflare API confirmed the `TICKET_SECRET` binding exists.
- GitHub Actions runs `node --check online-room-worker.js` and `node --check game-studio/kurog-online.js` on pushes and pull requests.
- A real authenticated multi-browser gameplay test is still required. The deployment can be live while end-to-end game success remains unverified until two signed-in KURO accounts join the same room and exchange events.

## Remaining migration boundary
This stage moves multiplayer WebSocket/presence/event delivery to Cloudflare Durable Objects. Account authentication, game configuration, room create/join authorization, rankings, cloud saves, and state writes remain on the current authenticated Supabase Edge Function API. Those are separate migrations and must not be described as fully moved to Durable Objects yet.

## Deployment workflow
The manual GitHub Actions deploy workflow is gated by repository variable `DEPLOY_DURABLE_OBJECTS=true` and expects `CF_API_TOKEN` and `CF_ACCOUNT_ID` repository secrets. The Worker and secret have already been deployed directly through the connected Cloudflare account.

## Temporary Durable Object storage retention

- Room state stored inside the Durable Object is temporary runtime state, not the canonical game record.
- When the last WebSocket disconnects, the Durable Object schedules a one-time cleanup alarm for five minutes later.
- A reconnect during that grace period cancels the alarm and keeps the stored room state.
- If the alarm runs with no connected sockets, it calls `storage.deleteAll()` and resets the in-memory cache. The next connection starts with empty Durable Object cache state; canonical room/game data remains in Supabase until the Supabase room-retention job expires the room.
- A lifecycle lock serializes connection setup and cleanup so a reconnect arriving while cleanup is queued takes precedence, and the alarm checks for active sockets before deleting.
- This cleanup only affects the room's own Durable Object storage. It does not delete Supabase accounts, profiles, scores, rankings, cloud saves, or published game assets.
- The Daifugo private hand/game-state table (`game_daifugo_private_sessions`) is keyed by `room_id` and has `ON DELETE CASCADE` to `game_online_rooms`, so the same safe room-expiry cleanup removes private hands only when their parent room is eligible for deletion. It is not separately time-pruned while a room is active.
