# KURO hybrid backend and file storage policy

## Current production boundary

- Cloudflare Workers serves KURO Lab and provides the application's API relay.
- Supabase remains the production system for Auth, Postgres/Data API, Realtime, and Edge Functions until each replacement has passed parity and security checks.
- Supabase Storage remains the source of truth for uploaded file binaries. Existing bucket names, object keys, access modes, and stored URLs are preserved.
- The Cloudflare D1 database named `kuro-migration-copy` is a migration/staging copy only. It is attached to the production Worker as `KURO_MIGRATION_DB` solely for admin-only, read-only migration diagnostics; regular application API traffic is not routed to it. It is not the live application database.
- A separate D1 database named `kuro-app-data-mirror` is bound as `KURO_APP_DB`. It is a one-way, read-only mirror of 61 allowlisted Supabase tables, refreshed by the scheduled outbox sync Worker. Only explicit read-only Worker routes use it; Supabase remains authoritative for all writes.
- Cloudflare R2 is not required for this architecture and must not be enabled by registering a payment card solely for this migration.

## Storage-only relay

The Worker exposes `POST /api/kuro-storage-relay` for Supabase Storage API requests and `GET /api/kuro-storage-relay?resource=...` for media reads.

The endpoint validates that all upstream paths belong to `/storage/v1/`. It rejects PostgREST, Auth, Realtime, and Edge Function paths. Read access remains restricted by the existing public-object and token-signed KURO SNS private-media checks. Uploads, deletes, and signed URL creation continue to be authorized by Supabase Storage policies and the user's session.

Application clients route Storage API calls through this endpoint while their non-Storage Supabase requests continue through the existing `/api/cloudflare-relay` route. Public media URLs used by the application are normalized to the Storage-only endpoint. The file bytes are still stored in Supabase; the Worker only relays requests and responses.

## Existing application media areas

The integration preserves the existing Storage usage for:
- account avatars
- KURO Store assets
- KURO SNS public media
- KURO SNS private media

Do not rename buckets, move files, rewrite object keys, change public/private settings, or delete objects as part of the database migration.

## Next migration stages

1. Keep the current production Supabase Auth and database active while the Cloudflare D1 copy is audited.
2. Port API operations to Workers/D1 in small groups. Implement equivalent ownership checks, validation, authorization, and audit logging before routing production traffic to D1.
3. Test login/session behavior, profile updates, SNS posts and private messages, shop purchases/inventory, KC and point records, game rankings, matchmaking, and notifications.
4. Use shadow reads or an isolated test environment to compare old and new results. Never allow a partially migrated writer to split authoritative records across production systems.
5. Only after parity, security review, backup, and rollback checks should a production feature be switched from Supabase Postgres to D1.
6. Keep Supabase Storage as the file origin unless a separately approved storage migration is planned.

## Safety and rollback

- No production data is deleted or moved by the Storage-only relay.
- No Supabase database or authentication endpoint is moved by this change.
- No R2 bucket, paid subscription, or payment-card registration is needed.
- To roll back the routing change, revert the Storage endpoint references and Worker route together; the underlying Supabase objects remain unchanged.

## Active application read mirror (2026-11-28)

The production Worker also has the separate `KURO_APP_DB` binding for the live-current-state mirror. The mirror is updated from Supabase outbox events once per minute. Current read-only application routes include home banners, authenticated portal history, public player XP/level/KC summary, and the public level leaderboard. The data may be briefly behind Supabase.

No XP award, KC award, shop purchase/refund, admin adjustment, game result, or matchmaking write is handled by this D1 read mirror. Their existing Supabase triggers, routines, Edge Functions, and transaction boundaries remain authoritative.

## D1 read-only diagnostic stage (2026-11-28)

- The existing database `kuro-migration-copy` is attached to the production Worker as `KURO_MIGRATION_DB`.
- The new `GET /api/migration/health` route is admin-only. It verifies the live admin role through the existing Supabase Security Gate, not through the copied `admin_users` table.
- The route executes only `SELECT COUNT(*)` statements against the D1 schema manifest's validated table names. It compares the actual D1 row count for each of the 89 copied tables with the manifest's copied row count.
- The diagnostic returns only counts, table names with count differences, and copy timestamps. It never returns user records or personal data and performs no writes to D1. The live Security Gate may write its normal audit event to Supabase.
- `/admin/migration.html` displays these checks. It requires an existing admin login.
- This diagnostic verifies internal D1 copy integrity, not live parity with Supabase. Source row estimates are approximate and are displayed separately from actual D1 count mismatches.
- No application reads or writes are routed to D1 yet. Supabase Auth, Postgres, Realtime, Edge Functions, and Storage remain production sources of truth.
- Do not switch any production feature to D1 until per-feature read/write parity, authorization/RLS equivalence, transactional behavior, rollback, and live-data synchronization have been implemented and tested.

## D1 structural readiness audit (2026-11-28)

The admin-only `GET /api/migration/structure` endpoint measures D1 catalog metadata using read-only queries. It returns aggregate schema counts only and does not return user rows or perform D1 writes. Authorization is checked against the live Supabase Security Gate; copied D1 admin records are never trusted for access control.

PostgreSQL source snapshot captured on 2026-11-28:

- 89 public base tables and 642 base-table columns; one view (`kuro_public_game_rewards`) with 8 columns.
- 89 tables have RLS enabled, with 136 policies.
- 257 PostgreSQL indexes, 150 foreign-key constraints, 89 primary-key constraints spanning 117 primary-key columns, 17 unique constraints, and 197 check constraints.
- 119 user-defined triggers and 92 SQL routines.

D1 live catalog audit:

- 89 manifest tables exist, with 642 columns and 117 primary-key columns. The per-table column counts were checked against the PostgreSQL base-table inventory and matched.
- D1 currently reports 82 indexes, zero foreign-key constraints, and zero triggers. The `kuro_public_game_rewards` view has since been created in the staging copy and verified to expose 8 columns and 5 rows, matching the Supabase view's row count at the time of comparison.
- SQLite/D1 does not provide PostgreSQL Row Level Security policies or PostgreSQL SQL routines as drop-in equivalents. Their required authorization and business logic must be inventoried and implemented in Workers (or another explicitly tested equivalent).
- Index counts are not expected to be copied one-for-one; all query paths must be reviewed and indexed for the D1 workload.

The dashboard deliberately reports `cutoverAllowed: false`. Matching table/column counts is only a structural checkpoint, not proof of type/default/constraint/transaction/RLS/business-logic parity. Keep all production app traffic on Supabase until every relevant policy, constraint, trigger, view, and routine has been reviewed and replaced, and functional/security parity plus rollback tests pass.

## First PostgreSQL view port (2026-11-28)

The read-only PostgreSQL view `public.kuro_public_game_rewards` was ported to the isolated D1 staging copy as `kuro_public_game_rewards`:

```sql
CREATE VIEW IF NOT EXISTS kuro_public_game_rewards AS
SELECT game_id, mode, reward_amount, enabled, required_cpu_difficulty,
       reward_label, reward_type, score_tiers
FROM kuro_coin_game_rewards
WHERE enabled = 1 AND reward_amount > 0;
```

Verification:
- PostgreSQL source view: 8 columns and 5 rows at comparison time.
- D1 staged view: 8 columns and 5 rows.
- D1 staged view row count equals the qualifying base-table row count (enabled and positive reward amount).
- The Worker structure endpoint compares the view and column counts. This is a staging migration only; no production API read has been rerouted.

## PostgreSQL routine, trigger, and RLS inventory (2026-11-28)

Read-only catalog inspection identified:
- 92 public routines: 72 marked `SECURITY DEFINER`, 86 written in PL/pgSQL and 6 in SQL.
- 119 user-defined triggers across 29 trigger functions.
- 136 public RLS policies across 41 tables; all 89 public base tables currently have RLS enabled.
- A single source view was found and has been ported to D1 staging as described above.

High-risk routine groups that need feature-level migration plans:
- Game state and matchmaking: Daifugo, Sevens, UNON, Werewolf, and online room joins/leaves.
- Game results and economy: score submission, verified Tic-Tac-Toe/number results, win events, KC awards, level/XP awards, and related ledger updates.
- Store and entitlements: purchase, free item claim, inventory discard, equipped item changes, and studio membership.
- Account/security: IP ban administration/checks, username rate limiting, account suspension enforcement, and new-user setup.
- Notifications and SNS: chat/post notification triggers and reply creation.

Important migration rule:
- The 72 `SECURITY DEFINER` routines must not be copied as if they were ordinary SQL. Each needs a documented caller, authenticated identity source, authorization check, transaction boundary, idempotency key where needed, and expected side effects before a Worker replacement is enabled.
- Triggers must be mapped to the operations that currently fire them. In particular, score-to-record synchronization, reward and level ledger writes, notifications, and account-suspension guards must remain atomic with their parent operation.
- RLS policy migration is per table and action (`SELECT`, `INSERT`, `UPDATE`, `DELETE`), not a single generic authenticated-user check.
- Pure read-only utilities can be ported separately, but are not production-routed until output parity and authorization behavior are tested.

Recommended sequence:
1. Finish the routine-to-caller and trigger-to-write-operation map for one feature at a time.
2. Port low-risk read-only projections and verify result parity.
3. Implement one feature's Worker handlers with explicit user identity derived from verified sessions, ownership checks, and D1 transactions.
4. Run functional, negative-authorization, concurrency, and rollback tests in staging.
5. Only then consider switching that feature's production traffic.

## Read-only level calculation routine port (2026-11-28)

Two deterministic read-only routines have been ported into the admin-only Worker preview:
- `kuro_level_xp_required`: reads the copied `kuro_level_thresholds` rows and applies the PostgreSQL fallback curve above the highest explicit threshold.
- `kuro_level_for_xp`: resolves the highest configured level for the supplied total XP, then advances through the same fallback curve.

The admin-only `GET /api/migration/level-preview` route:
- Reads only the ten copied threshold rows from D1.
- Checks that those threshold rows match the PostgreSQL source snapshot.
- Compares ten known XP-to-level cases captured from the live PostgreSQL routines.
- Returns only the deterministic test values and parity status.
- Does not write D1 or Supabase data and does not change any production route.

The preview is not a replacement for XP award/ledger routines. Those writes remain on Supabase until their trigger, transaction, and authorization semantics are ported and tested.
