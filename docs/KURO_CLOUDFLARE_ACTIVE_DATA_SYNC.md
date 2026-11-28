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
## Economy and Store write-authority cutover

- The initial snapshot remains a one-way mirror until the explicit D1 authority flag is enabled.
- `kuro-data-sync` keeps mirroring KC/XP balances, ledgers, reward settings, claims, Store inventory, equipment and transactions while `__kuro_economy_mirror_control.d1_write_authority` is `0`.
- The D1 economy API rejects all economy and Store mutations with HTTP 503 while the flag is `0`; read endpoints remain available. This is an intentional fail-closed gate during deployment.
- Only after the new `kuro-lab` Worker and updated Supabase Edge Functions are deployed, the initial cutover migration is applied, D1 schema version 5 is present, parity and duplicate checks pass, and the Supabase outbox is empty may the final mirror-detachment migration be applied.
- Before enabling D1 writes, verify the mirror outbox is still empty and the D1 sync worker has no error. Then set `d1_write_authority=1` on the production D1 control row. From that point, the sync worker acknowledges but does not apply old Supabase mutations for the D1-owned economy tables.
- Do not set the D1 authority flag before every updated client/Edge Function path is ready. Do not re-enable legacy Supabase economy triggers after D1 has accepted live writes; rollback must preserve a single writer.
- Supabase Auth remains the identity provider. Supabase also retains historical rows as rollback evidence; the live KC/XP/Store write authority moves to Cloudflare D1.
## Production cutover completed — 2026-11-28

- Production D1 database `kuro-app-data-mirror` is the live write authority for KC balances/ledger/rewards, XP levels/ledger/rewards and Store inventory/equipment/transactions.
- `__kuro_economy_mirror_control.d1_write_authority` is `1`; do not reset it to `0` as a casual rollback.
- Supabase migrations `cloudflare_economy_write_cutover` and `cloudflare_d1_economy_write_authority` have been applied. The old Supabase reward writers and the 13 economy-table mirror triggers have been removed. Supabase Auth remains active.
- Updated Edge Functions are active: `admin-console` v69, `kurogames-store` v17, `kuro-public-coin-balance` v2 and `kurogames-online` v136. Their existing JWT verification settings are preserved.
- The D1 schema is v5. The data-sync Worker continues mirroring non-economy data and the append-only `kuro_economy_pending_events` queue. Pending economy events use `INSERT OR IGNORE`; never convert them to `INSERT OR REPLACE` or delete-and-reinsert during retry.
- D1-authoritative economy tables are skipped by the mirror when the authority flag is `1`. Do not restore their old Supabase mirror triggers or write to their Supabase snapshots after cutover.
- Final pre-cutover table counts matched across Supabase and D1: KC balances 5, KC ledger 39, level users 7, XP ledger 246, reward claims 1, Store inventory 3, equipped items 2 and Store transactions 7. Other settings/reward tables also matched by row count.
- The one-time duplicate replay validation passed: XP award and level milestone were applied once; replaying the same event or a second event with the same submission ID did not add XP again; KC game reward was also applied once. Synthetic test rows were removed afterward.
- Post-cutover outbox entries for unrelated chat/notification tables remain eligible for normal mirroring. They are not evidence that D1-owned economy tables are being written back to Supabase.
- Rollback must preserve one writer. Do not re-enable legacy Supabase economy triggers or switch the D1 flag off after live D1 writes have occurred without a separately validated reverse migration.
