# KURO Cloudflare Active Data Mirror

## Purpose

This is the first Cloudflare-side copy of KURO's frequently used operational data. Cloudflare D1 is located in the APAC region and is bound to the existing `kuro-lab` Worker as `KURO_APP_DB`.

This is a **read-only application mirror**. Supabase remains authoritative for all writes and business transactions. A scheduled outbox Worker synchronizes the 61 allowlisted active tables into this D1 database every minute. Only explicitly implemented Worker GET endpoints read from the mirror; all other application flows continue to use Supabase.

## Snapshot

- Snapshot time (UTC): `2026-11-28 02:19:12`
- Cloudflare D1 database: `kuro-app-data-mirror`
- D1 database ID: `7ed0a9f4-da8b-4e67-b4b5-66480accf080`
- Primary region: `APAC`
- Copied active/current-state tables: **61**
- Initial copied rows at snapshot time: **1,337** (the live mirror count changes as outbox events are applied)
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
5. The outbox Worker synchronizes current-state rows once per minute. D1 reads can therefore lag Supabase briefly; keep Supabase authoritative and reserve D1 reads for explicitly documented projections with a fallback/rollback path.
6. Do not point the existing migration diagnostics binding `KURO_MIGRATION_DB` at this database. It is a separate diagnostic snapshot.
7. D1 read replication is currently disabled. Re-evaluate consistency and current plan limits before enabling replicas or relying on this database for global latency-sensitive traffic.
8. R2 was not enabled as part of this work. No paid Cloudflare product was enabled.

## Active read-only routes (2026-11-28)

The following application paths use `KURO_APP_DB` as a read mirror while Supabase remains the write authority:

- `GET /api/kuro-d1/home-banners`: public active home-banner projection.
- `GET /api/kuro-d1/portal-history`: authenticated, user-scoped portal history.
- `GET /api/kuro-d1/public-player-summary?userId=...`: publicly visible KC balance, XP/level state, and level thresholds for an existing profile. The exposed fields match the existing public balance endpoint and public level read policies.
- `GET /api/kuro-d1/level-leaderboard`: top 50 public level entries joined to public profile display fields.
- `GET /api/kuro-d1/leaderboard?gameId=...&mode=...`: public game leaderboard projection gated by published-game status and the game's ranking feature setting. It preserves canonical metric sorting and the existing verified-source filters for Number Guess, Tic-Tac-Toe HARD CPU, Prime Factorization, Sushi Typing, and UNON hard CPU records; Daifugo bot claims remain unavailable.\n- `GET /api/kuro-d1/published-games`: public catalogue for published Studio games, including display metadata and image URLs.\n- `GET /api/kuro-d1/published-game?id=...`: public HTML and JavaScript for a published Studio game only; drafts and unpublished entries are never returned.

All endpoints are read-only and return `Cache-Control: no-store`. The active mirror sync cadence is once per minute, so a newly awarded XP/KC balance can appear in D1 with a short delay. The write paths and XP/KC ledger/claim triggers remain on Supabase. In particular, verified wins, level awards, milestone rewards, purchases, refunds, and admin adjustments must not be switched to D1 until their full transactional and idempotency behavior has been reimplemented and verified.

The level-up notification poll continues to read the Supabase ledger so immediate level-up effects are not delayed by the mirror's sync interval. The public games page and game launcher now read published game metadata/code from D1 first and fall back to the existing Supabase query when the D1 endpoint fails. The game launcher also falls back when the requested published game is not present in D1 yet, covering the short synchronization window after publication. The catalogue itself can therefore show a newly published game after the next mirror sync (normally about one minute). Studio create/edit/publish writes remain on Supabase for now.
Client code retains the previous Supabase read path as an automatic fallback if a D1 projection is temporarily unavailable. A D1 error therefore does not disable profile, KC, or level display. The public ranking page and homepage showcase also use D1 first and fall back to the existing `kurogames-online` leaderboard action. Signed-in viewers on modes requiring pending verified-session reconciliation continue through that original action.

## Next migration stages

1. Continue moving low-risk public/read-only projections to D1 with source parity checks and a fallback path.
2. Port XP/level award and KC reward writes as one transactional feature group, including unique event/claim constraints, ledger effects, notifications, and concurrency tests.
3. Move ranking reads only after ranking-specific filters and visibility rules have been matched.
4. Port online matchmaking/game state separately using a coordination design appropriate to each game (including durable room ownership, membership, ready state, and cleanup).
5. Move shop reads and purchases only after inventory, balance, ledger, idempotency, and refund semantics are covered.
6. Consider R2 separately for file binaries; do not move existing Supabase Storage objects as part of the D1 work.

## What this change does not do

- It does not replace Supabase Auth, Realtime, Storage, PostgreSQL functions, or Edge Functions.
- It does not switch production reads or writes to D1.
- It does not delete or alter any Supabase data.
- It does not copy auth credentials or media binaries.
- It does not claim that the snapshot stays synchronized automatically.
