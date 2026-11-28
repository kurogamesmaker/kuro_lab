# KURO Supabase → Cloudflare D1 automatic mirror sync

## Architecture

- Supabase remains the authoritative source of truth.
- Row-level Postgres triggers write changes from the 66 active mirror tables into a private outbox.
- The dedicated Cloudflare Worker `kuro-data-sync` runs every minute through a Cron Trigger.
- Each run requests up to 100 oldest outbox events, applies them to the APAC D1 database `kuro-app-data-mirror`, then acknowledges those exact event IDs.
- If a D1 batch fails, the events are not acknowledged and will be retried. If the acknowledgement RPC fails after the D1 commit, replay is idempotent because D1 uses primary-key upserts/deletes.
- The queue is acknowledged by event IDs rather than a maximum-ID cursor, avoiding skipped events when concurrent Postgres transactions commit out of sequence.
- The KuroGames homepage ticker reads only the public active-banner projection from D1 through `/api/kuro-d1/home-banners`.
- Authenticated portal history reads use `/api/kuro-d1/portal-history`; the Worker validates the Supabase access token and derives the user ID from Auth before querying D1.
- Public game/profile read projections use `/api/kuro-d1/public-player-summary` for the existing public KC balance, XP/level state, and thresholds, and `/api/kuro-d1/level-leaderboard` for the top 50 level entries with public profile display fields.
- Public game rankings use `/api/kuro-d1/leaderboard` from the main ranking page and homepage showcase. The endpoint validates that the game is published and ranking is enabled, then applies the same canonical metric and verified-source conditions as the existing leaderboard handler. Signed-in clients send their session marker; modes requiring pending verified-session reconciliation are deliberately sent back to the existing Supabase action.
- The economy backfill includes a final private `__kuro_economy_mirror_control` marker. The D1 coin-summary endpoint returns an initializing response until that marker arrives, ensuring the initial ledgers are not shown half-synchronized.\n- `GET /api/kuro-d1/coin-summary` validates the Supabase access token, derives the user ID from Auth, checks the mirrored account-suspension state, and returns only that user's KC balance plus the latest 20 transactions. The points page and KuroGames mypage use this endpoint first and retain the existing Edge Function as fallback.\n- The active allowlist now mirrors `kuro_coin_ledger`, `kuro_level_ledger`, `kuro_level_coin_reward_claims`, and `kuro_coin_verified_game_events`, plus private `account_suspensions` for account-state checks. These rows are mirrored for read parity only; all economy writes remain Supabase-authoritative in this stage.

## Security

- No Supabase service-role key is used in the Worker.
- The Worker uses the project's publishable API key plus a separate random sync secret stored as a Cloudflare Worker Secret.
- Supabase stores only the SHA-256 hash of that secret in a table with RLS enabled and no client grants.
- Pull/ack RPCs are SECURITY DEFINER with an empty search path and require the shared secret.
- The outbox table has RLS enabled and no direct client grants.
- The Worker has an explicit 66-table allowlist (including the retired portal-favorites acknowledgement and the private economy snapshot marker) and validates SQL identifiers before generating prepared D1 statements.
- Auth identities/passwords/sessions, Storage binaries, audit/security/transaction ledgers, analytics history and archives are not part of the sync allowlist.

## Operational behavior

- Cron cadence: once per minute (UTC).
- Max events per run: 100.
- Updates are applied as delete-old-primary-key then insert-or-replace-new-row, covering primary-key changes as well as ordinary updates.
- Deletes remove the row by its old primary key.
- Worker state is recorded in D1 table `__kuro_cloudflare_sync_state`.
- Public `/health` exposes only worker health and non-row-level sync status, not user content or secrets.

## Scope and limitations

- This is one-way Supabase → Cloudflare synchronization. Cloudflare D1 is not yet the write authority; economy ledgers are included as synchronized read projections only.
- Supabase remains the authoritative write source. Only the explicit read-only endpoints listed above use D1; all other app reads and all writes continue to use Supabase until per-feature authorization, triggers, RPCs and integrity rules have been ported and tested.
- Client reads automatically fall back to the existing Supabase query/function path if an individual D1 read projection fails. The authenticated KuroGames SDK's ranking calls and all ranking submissions remain on the existing Edge Function path; only the public web ranking surfaces are D1-first.
- If the source schema changes, apply the corresponding D1 schema migration before allowing the Worker to sync those new columns. Schema mismatches deliberately stop and retain the event for retry.
- A backlog larger than 100 events is processed over multiple Cron runs.
