# KURO Durable Online Room

## Live deployment
- Worker: `kuro-online-room`
- Public endpoint: `https://kuro-online-room.kurogamesmaker.workers.dev`
- Health path: `/health`
- Durable Object class: `Room`
- Namespace ID: `9633b9fd379f4e0690c398d3933b8dcd`
- Namespace storage: SQLite
- Latest verified Cloudflare deployment: `e457b0e087854bcabdb3666bb4f06cb5` (100% traffic)
- Secret binding configured: `TICKET_SECRET` (value is not stored in GitHub)

## Authentication policy

All online features require a signed-in KURO account authenticated by Supabase Auth. This applies uniformly to multiplayer room creation/joining, room lists, room events, online rankings, cloud saves, profile reads, and online settings. Offline and CPU gameplay remain available without an account.

- The browser and Studio preview pass only the current Supabase Auth access token to the KuroGames SDK.
- The `kurogames-online` Edge Function validates the token with `admin.auth.getUser`; two-part Cloudflare guest tokens and anonymous Supabase Auth sessions are rejected.
- The Worker issues connection tickets only after validating the Supabase account token and confirming room membership.
- Account connection tickets carry `typ: kuro_account`; the WebSocket endpoint rejects legacy guest tokens even if one was issued before this policy.
- The retired `/guest-token` and `/guest/verify` routes return HTTP 410 and never issue or validate guest credentials.
- Existing historical guest records are not deleted. Old room entries naturally expire; they cannot authenticate, create new rooms, or rejoin.

- Supabase Edge Function `kurogames-online`: deployed version 27 with account-only authorization.

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
- GitHub Actions runs `node --check online-room-worker.js`, `node --test tests/online-room-worker.test.mjs`, `node --check game-studio/kurog-online.js`, and embedded-script syntax checks on pushes and pull requests.
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
- Daifugo private hands/game state (`game_daifugo_private_sessions`) and ready flags (`game_daifugo_room_ready`) both have `ON DELETE CASCADE` foreign keys to `game_online_rooms`. The same safe room-expiry cleanup removes both only when the parent room is eligible for deletion; neither is separately time-pruned while a room is active.

## Supabase temporary room retention

- The scheduled database job `kuro-cleanup-temporary-game-data` runs every five minutes.
- Waiting matchmaking entries are removed after two minutes without a heartbeat. Matched entries are removed after their 15-minute acknowledgement window, or when their room is no longer usable.
- Waiting rooms are removed after 30 minutes if no member has sent a heartbeat in the previous 15 minutes.
- Playing rooms are removed after 15 minutes without any member heartbeat. A 15-minute reconnect grace period protects recently active members.
- Closed or expired rooms are removed only when no member has sent a heartbeat in the previous 15 minutes. Empty orphan rooms receive a 30-minute grace period.
- Active rooms are protected by member heartbeats; when their expiry approaches, the cleanup function refreshes the expiry to two hours ahead.
- Werewolf rooms are removed two hours after `gameover`, or after 24 hours without an update. Werewolf room chat and online room events are removed through their room foreign-key cascades.
- Daifugo private hands and ready flags cascade only when the corresponding online room is safely removed.
- The cleanup function has a read-only dry-run mode, uses batched deletes and a transaction advisory lock, and never touches accounts, profiles, ranking scores, win-event records, cloud saves, or published game assets.

## Operational log retention

- The scheduled database job `kuro-cleanup-operational-logs` runs daily at 15:30 UTC (00:30 JST).
- `usage_events` keeps 90 days. The admin analytics endpoint reads a rolling 30-day window, so this preserves its full reporting range with a buffer.
- `admin_audit_logs` keeps 365 days for administrator-action traceability.
- `admin_email_logs` keeps 90 days; its date index is added by the retention migration.
- `cron.job_run_details` keeps 14 days because pg_cron does not remove execution history automatically.
- The function supports a read-only dry run, uses an advisory lock and batched deletes, and is not executable by public/anon/authenticated roles.
- The cleanup does not delete accounts, profiles, ranking scores, win events, cloud saves, published assets, posts, replies, follows, or group chat content. The current 6,233 usage events and 13 audit records were preserved; the dry run reported zero deletion candidates and the first execution deleted zero rows.



## Notification and read-receipt retention

- The scheduled job `kuro-cleanup-read-notifications` runs daily at 15:45 UTC (00:45 JST).
- Social notifications are deleted only when `read_at` is at least 90 days old. Unread notifications are never removed by this job. This covers old mention notifications that remain until a user opens the linked group conversation.
- Portal request notifications are deleted only when `read_at` is at least 180 days old. Unread request notifications remain.
- The KUROSNS notification screen loads the latest 50 notifications. It removes viewed non-mention notifications immediately, marks remaining notifications as read, and removes a mention notification when its linked group is opened. The scheduled policy is a long-term safety net for old read notices that are not otherwise cleared.
- Direct-message read receipts are not independently pruned: their parent messages are removed by the existing `kuro-delete-read-chat-messages-daily` job only after a receipt has been present for at least one day; deleting a message cascades its receipt.
- Group-chat and admin-message read receipts remain attached to their messages because they are used to display read state for retained messages. The corresponding foreign keys cascade if the parent message is explicitly removed.
- The cleanup supports dry-run and batched deletion, uses an advisory lock, and never changes chat message bodies, group messages, admin messages, posts, or unread notifications.
- Verification found no orphaned direct-message, group-message, or admin-message read receipts. Current data is 72 social notifications (52 unread), 1 portal request notification, 14 direct messages, and 44 group messages; the first cleanup deleted zero rows. A rollback-only test verified that aged read notices are deleted while old unread notices are preserved.


## Public lobby chat daily analytics

- The daily cleanup job continues deleting public lobby chat content at 00:00 JST, but first records message counts by Tokyo calendar date in `public_chat_daily_stats`.
- The archive stores only the date, total message count, and update timestamp. It does not retain nicknames, message text, user IDs, or any chat content.
- Snapshot and deletion happen atomically in one database transaction. If the transaction fails, neither the daily count nor the deletion is committed; retrying does not double-count already deleted rows.
- KUROADMIN's `get_admin_overview` endpoint combines archived daily counts with messages still present in the live chat table. Thus a midnight content purge no longer resets earlier dates on the daily chart.
- The daily counts are retained independently of the temporary chat rows. The snapshot table is private to the service role; anonymous and authenticated client roles cannot read it directly.
- Verification used one temporary test message alongside the current live row: both were counted for the Tokyo date and the live table was emptied inside the test transaction. The test transaction was rolled back, restoring the live row and leaving no test snapshot.
- Daily history begins when this snapshot system is enabled. Older daily values that were already lost through earlier full-table purges cannot be reconstructed exactly from the current database.

## Other existing chat retention jobs

- `kuro-delete-public-chat-daily` runs daily at 15:00 UTC (00:00 JST). It now calls `kuro_archive_and_clear_public_chat()`, which groups all deleted messages by their `Asia/Tokyo` calendar date, adds those counts to `public_chat_daily_stats`, and deletes the original chat rows in the same transaction. This keeps the public lobby short-lived while preserving daily counts for KUROADMIN.
- `kuro-delete-read-chat-messages-daily` runs every 15 minutes and deletes a DM if it has any read-receipt row older than one day. During this audit, `chat_message_reads` contained zero rows, so this job had no eligible messages to delete. This rule is separate from the new operational-log cleanup and should be reviewed independently before changing its behavior.
- Group chat messages are not included in either of those chat-retention jobs and currently have no automatic time-based cleanup.
- KUROSNS posts and replies are not time-pruned.
