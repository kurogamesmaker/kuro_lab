# KURO PostgreSQL to D1 migration inventory

**Source metadata snapshot:** 2026-11-28  
**Production source of truth:** Supabase Postgres  
**Staging target:** Cloudflare D1 `kuro-migration-copy`

This file records catalog metadata, not application rows. The inventory is a point-in-time snapshot and must be refreshed before each production cutover decision.

## Catalog summary

| Object | PostgreSQL source |
|---|---:|
| Public base tables | 89 |
| Base-table columns | 642 |
| Tables with RLS enabled | 89 |
| RLS policies | 136 across 41 tables |
| Views | 1 |
| Public routines | 92 |
| `SECURITY DEFINER` routines | 72 |
| PL/pgSQL routines | 86 |
| SQL routines | 6 |
| User-defined triggers | 119 across 29 trigger functions |
| Indexes | 257 |
| Foreign-key constraints | 150 |
| Primary-key constraints | 89 |
| Primary-key columns | 117 |
| Unique constraints | 17 |
| Check constraints | 197 |

## D1 staging checkpoint

The base-table structure audit found 89 tables, 642 columns, and 117 primary-key columns, matching the PostgreSQL counts. The following source view was migrated to the D1 staging copy:

- `kuro_public_game_rewards`: 8 columns; 5 rows at source comparison time; D1 staged view returned 8 columns and 5 rows.
- No application request is routed to this D1 view.

D1 still requires feature-level work for:
- 150 foreign-key constraints
- 119 trigger behaviors
- 136 RLS policies (D1 does not provide PostgreSQL RLS)
- 92 SQL routines (many are security-sensitive or transactional)
- UNIQUE and CHECK constraint semantics
- Per-query index design (257 PostgreSQL indexes versus 82 D1 indexes at the preceding audit)

## High-risk migration groups

### Game operations
- Daifugo: start/action/state, ready-state, matchmaking join/status/ack/cancel
- Sevens: start/action/state/sync, room votes, matchmaking
- UNON: matchmaking join/status/ack/cancel/try-match
- Werewolf: join/action/state/room synchronization
- Generic online-room join/leave and score submission

### Economy and records
- Verified game events and win events
- KC reward issuance and notifications
- XP/level award and recalculation
- Game score and user-record synchronization
- Admin KC/XP adjustments

### Store and entitlements
- Store purchases, free item claims, inventory discard, equipped item changes
- Studio sales summary and member management
- User cosmetic projection

### Account, security, and moderation
- User creation and profile alias synchronization
- Immutable KURO ID and account suspension guards
- IP ban create/list/log/revoke/check
- Username auth rate-limit accounting

### SNS, chat, and notifications
- Post reply creation
- Like/reply/chat notification triggers
- Public-chat archival and clearing
- Portal-request reply notifications

## Porting requirements

For each routine, record:
1. Public/Worker caller and exact input contract.
2. Identity source: user ID must come from the verified session, not an untrusted request body.
3. Authorization rule and the source RLS policy or admin gate it replaces.
4. Transaction boundary and all rows written.
5. Idempotency behavior for retries and duplicate submissions.
6. Trigger side effects that must remain atomic.
7. Error mapping and audit-event behavior.
8. Positive, negative-authorization, concurrency, and rollback tests.

Do not port `SECURITY DEFINER` routines as ordinary SQL without preserving their access boundary. Do not split balances, game outcomes, rewards, or notification side effects across independently committed writes.

## Recommended order

1. Read-only views/projections with result-parity tests.
2. Simple deterministic utility functions with unit tests.
3. Low-risk profile and read endpoints with explicit ownership/public visibility checks.
4. One write feature at a time, including its triggers, constraints, RLS replacement, and transaction tests.
5. Only after a feature has passed parity and rollback tests, consider a guarded production traffic switch.

**Current status:** staging-only; production cutover prohibited.
