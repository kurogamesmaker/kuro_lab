# KURO Supabase → Cloudflare D1 automatic mirror sync

## Architecture

- Supabase remains the authoritative source of truth.
- Row-level Postgres triggers write changes from the 61 active mirror tables into a private outbox.
- The dedicated Cloudflare Worker `kuro-data-sync` runs every minute through a Cron Trigger.
- Each run requests up to 25 oldest outbox events, applies them to the APAC D1 database `kuro-app-data-mirror`, then acknowledges those exact event IDs.
- If a D1 batch fails, the events are not acknowledged and will be retried. If the acknowledgement RPC fails after the D1 commit, replay is idempotent because D1 uses primary-key upserts/deletes.
- The queue is acknowledged by event IDs rather than a maximum-ID cursor, avoiding skipped events when concurrent Postgres transactions commit out of sequence.
- The KuroGames homepage ticker reads only the public active-banner projection from D1 through `/api/kuro-d1/home-banners`. The endpoint returns the same allowlisted display fields and applies the same active-window filter as the former public Supabase RLS read. Supabase remains the write authority for banners; D1 read freshness follows the one-minute sync schedule.

## Security

- No Supabase service-role key is used in the Worker.
- The Worker uses the project's publishable API key plus a separate random sync secret stored as a Cloudflare Worker Secret.
- Supabase stores only the SHA-256 hash of that secret in a table with RLS enabled and no client grants.
- Pull/ack RPCs are SECURITY DEFINER with an empty search path and require the shared secret.
- The outbox table has RLS enabled and no direct client grants.
- The Worker has an explicit 61-table allowlist and validates SQL identifiers before generating prepared D1 statements.
- Auth identities/passwords/sessions, Storage binaries, audit/security/transaction ledgers, analytics history and archives are not part of the sync allowlist.

## Operational behavior

- Cron cadence: once per minute (UTC).
- Max events per run: 25.
- Updates are applied as delete-old-primary-key then insert-or-replace-new-row, covering primary-key changes as well as ordinary updates.
- Deletes remove the row by its old primary key.
- Worker state is recorded in D1 table `__kuro_cloudflare_sync_state`.
- Public `/health` exposes only worker health and non-row-level sync status, not user content or secrets.

## Scope and limitations

- This is one-way Supabase → Cloudflare synchronization. Cloudflare D1 is not yet the write authority.
- The current KURO app remains routed to Supabase. Do not change app reads/writes until per-feature authorization, triggers, RPCs and integrity rules have been ported and tested.
- If the source schema changes, apply the corresponding D1 schema migration before allowing the Worker to sync those new columns. Schema mismatches deliberately stop and retain the event for retry.
- A backlog larger than 25 events is processed over multiple Cron runs.
