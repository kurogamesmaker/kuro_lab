# KURO hybrid backend and file storage policy

## Current production boundary

- Cloudflare Workers serves KURO Lab and provides the application's API relay.
- Supabase remains the production system for Auth, Postgres/Data API, Realtime, and Edge Functions until each replacement has passed parity and security checks.
- Supabase Storage remains the source of truth for uploaded file binaries. Existing bucket names, object keys, access modes, and stored URLs are preserved.
- The Cloudflare D1 database named `kuro-migration-copy` is a migration/staging copy only. It is attached to the production Worker as `KURO_MIGRATION_DB` solely for admin-only, read-only migration diagnostics; regular application API traffic is not routed to it. It is not the live application database.
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
- D1 currently reports 82 indexes, zero foreign-key constraints, zero triggers, and zero views.
- SQLite/D1 does not provide PostgreSQL Row Level Security policies or PostgreSQL SQL routines as drop-in equivalents. Their required authorization and business logic must be inventoried and implemented in Workers (or another explicitly tested equivalent).
- Index counts are not expected to be copied one-for-one; all query paths must be reviewed and indexed for the D1 workload.

The dashboard deliberately reports `cutoverAllowed: false`. Matching table/column counts is only a structural checkpoint, not proof of type/default/constraint/transaction/RLS/business-logic parity. Keep all production app traffic on Supabase until every relevant policy, constraint, trigger, view, and routine has been reviewed and replaced, and functional/security parity plus rollback tests pass.
