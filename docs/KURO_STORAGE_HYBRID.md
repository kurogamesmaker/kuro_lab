# KURO hybrid backend and file storage policy

## Current production boundary

- Cloudflare Workers serves KURO Lab and provides the application's API relay.
- Supabase remains the production system for Auth, Postgres/Data API, Realtime, and Edge Functions until each replacement has passed parity and security checks.
- Supabase Storage remains the source of truth for uploaded file binaries. Existing bucket names, object keys, access modes, and stored URLs are preserved.
- The Cloudflare D1 database named `kuro-migration-copy` is a migration/staging copy only. It is not bound to the production Worker and is not the live application database.
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
