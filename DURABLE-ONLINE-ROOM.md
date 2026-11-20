# KURO Durable Online Room

## Live deployment
- Worker: `kuro-online-room`
- Public endpoint: `https://kuro-online-room.kurogamesmaker.workers.dev`
- Health path: `/health`
- Durable Object class: `Room`
- Namespace ID: `9633b9fd379f4e0690c398d3933b8dcd`
- Namespace storage: SQLite
- Latest verified Cloudflare deployment: `d580d475-5acc-4dec-ade7-480b08d8ad5c` (100% traffic)
- Secret binding configured: `TICKET_SECRET` (value is not stored in GitHub)

## Runtime flow
1. The existing KuroGames SDK continues to call the current authenticated `kurogames-online` API for game configuration and room creation/join.
2. The SDK requests a short-lived ticket from `POST /ticket` using the user's Supabase access token.
3. The Worker validates the token with Supabase Auth and checks actual room membership via the existing `room_poll` action.
4. The Worker signs a 60-second ticket and forwards the authenticated WebSocket to the room's Durable Object.
5. The DO derives player identity from trusted Worker headers, never from client-supplied player IDs. It manages connection presence and broadcasts game events.
6. Room state get/update remain on the existing authenticated API for backwards-compatible persistence and optimistic concurrency. The DO carries real-time notifications/events.

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
