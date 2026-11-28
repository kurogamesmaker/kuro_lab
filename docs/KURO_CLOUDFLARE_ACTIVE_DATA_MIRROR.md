# KURO Cloudflare Active Data Mirror

## Purpose

This is the first Cloudflare-side copy of KURO's frequently used operational data. Cloudflare D1 is located in the APAC region and is bound to the existing `kuro-lab` Worker as `KURO_APP_DB`.

This is a **snapshot/mirror only**. The current production application remains connected to Supabase. No application read/write path has been switched to D1, and no ongoing synchronization is configured by this change.

## Snapshot

- Snapshot time (UTC): `2026-11-28 02:19:12`
- Cloudflare D1 database: `kuro-app-data-mirror`
- D1 database ID: `7ed0a9f4-da8b-4e67-b4b5-66480accf080`
- Primary region: `APAC`
- Copied active/current-state tables: **61**
- Copied rows: **1,337**
- Public table/view schema copied from the previous schema inventory: **89 tables + 1 view**
- Secondary indexes added for common feed, notification, chat, matchmaking, leaderboard, profile, store, and portal lookups: **22 indexes**

All 61 table row counts were re-read from D1 after import and totalled 1,337. The source data was queried from Supabase and inserted into the new D1 database. The original Supabase data was not modified.

## Data copied to D1

The current-state subset contains frequently accessed operational data for:

- Profiles and social graph
- Posts, likes, replies, follows, notifications
- Direct and group chat messages, conversations, and read markers
- Public chat counters/messages and game activity presence
- Online-game settings, rooms, room members/messages, matchmaking, and room-ready state
- Game scores, verified game result summaries, saves, Seven's results, Werewolf state, and world blocks
- Game Studio published/draft game records
- Current KC balances, game reward settings, game user statistics, win events, current XP/level state and reward configuration
- Store catalogue, design drafts, equipped items, studio membership, and user inventory
- Home banners, portal announcements/preferences/history, admin messages/read markers, and user last-activity state

Some operational tables currently contain zero rows; their schemas were copied so they can be populated after a future, reviewed application migration.

## Data intentionally kept in Supabase

Supabase remains the source of truth for data not included in this initial active-data snapshot, including:

- Supabase Auth identities, password hashes, refresh tokens, sessions, and auth metadata
- Storage objects and original image/video/file binaries
- Low-frequency analytics such as `usage_events`
- Security events, IP-ban records, audit logs, moderation reports, account suspension cases, and anti-cheat verification sessions
- KC/XP/store financial or claim ledgers and other transaction history
- Archived game event/stat tables
- Infrequently used request and application workflows
- Push subscription credentials and username-auth/rate-limit state

The D1 schema may contain empty copies of some Supabase public tables because all public table definitions were carried over, but no rows for these cold/sensitive tables were copied into this mirror.

## Safety and consistency rules

1. Supabase remains authoritative until each application flow has been migrated and verified.
2. Do not expose `KURO_APP_DB` directly to browsers. Browser clients must not receive Cloudflare D1 credentials or bypass Worker authorization.
3. Before moving any read or write path, port and test the corresponding Supabase RLS ownership rules, constraints, triggers, RPC/function behavior, and any Edge Function authorization into server-side Worker code.
4. Auth and media/file binaries stay in Supabase for this phase.
5. The snapshot will become stale as soon as Supabase changes. A controlled sync/outbox process and reconciliation checks are required before D1 can serve live reads or writes.
6. Do not point the existing migration diagnostics binding `KURO_MIGRATION_DB` at this database. It is a separate diagnostic snapshot.
7. D1 read replication is currently disabled. Re-evaluate consistency and current plan limits before enabling replicas or relying on this database for global latency-sensitive traffic.
8. R2 was not enabled as part of this work. No paid Cloudflare product was enabled.

## Next migration stages

1. Add a server-side Worker data-access layer using `env.KURO_APP_DB`, initially behind explicit feature flags.
2. Implement an auditable sync strategy from Supabase to D1 (prefer an outbox/change stream over periodic full-table copies); define conflict handling and deletion propagation.
3. Port and test per-feature authorization and data integrity rules before moving any table to Cloudflare as the write authority.
4. Canary read-only paths first (for example public catalogue/configuration or selected leaderboard views), compare results against Supabase, and monitor Worker/D1 usage.
5. Migrate writes feature by feature only after idempotency, transaction behavior, rollback, and dual-read reconciliation are verified.

## What this change does not do

- It does not replace Supabase Auth, Realtime, Storage, PostgreSQL functions, or Edge Functions.
- It does not switch production reads or writes to D1.
- It does not delete or alter any Supabase data.
- It does not copy auth credentials or media binaries.
- It does not claim that the snapshot stays synchronized automatically.
