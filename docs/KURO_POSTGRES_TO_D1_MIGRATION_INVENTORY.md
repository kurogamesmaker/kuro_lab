# KURO PostgreSQL to D1 migration inventory

**Catalog snapshot:** 2026-11-28  
**Production source of truth:** Supabase PostgreSQL  
**Staging target:** Cloudflare D1 `kuro-migration-copy`

This document records database catalog metadata, not application rows. Counts and object definitions are a point-in-time snapshot; refresh them before any production cutover decision.

## Catalog summary

| Object | PostgreSQL source |
|---|---:|
| Public base tables | 89 |
| Base-table columns | 642 |
| Tables with RLS enabled | 89 |
| Tables with at least one policy | 41 |
| RLS policies | 136 |
| — permissive | 99 |
| — restrictive | 37 |
| — SELECT / INSERT / UPDATE / DELETE / ALL | 42 / 30 / 13 / 14 / 37 |
| Views | 1 |
| Public routines | 92 |
| — SECURITY DEFINER | 72 |
| — PL/pgSQL / SQL | 86 / 6 |
| User-defined triggers | 119 |
| Distinct trigger functions | 29 |
| Indexes | 257 |
| Foreign-key constraints | 150 |
| Primary-key constraints / columns | 89 / 117 |
| Unique constraints | 17 |
| Check constraints | 197 |

RLS is enabled on all 89 tables, but catalog inspection found policies on 41 of them. The remaining 48 RLS-protected tables do not have a policy listed in `pg_policies`; do not assume they are accessible. Their current access behavior must be checked against the actual database role and service call path.

## D1 staging checkpoint

The base-table structure audit found 89 tables, 642 columns, and 117 primary-key columns, matching PostgreSQL counts. The following source view has been ported to the D1 staging copy:

- `kuro_public_game_rewards`: 8 columns; 5 rows at source comparison time; the D1 view returned 8 columns and 5 rows.
- D1 level thresholds: 10 rows, matching the source snapshot.
- Two read-only Worker calculation routines have been ported to an admin-only parity preview: `kuro_level_xp_required` and `kuro_level_for_xp`. Ten XP test cases matched the results obtained from PostgreSQL at snapshot time.
- No production endpoint reads from the staged view or the level-preview helper.

D1 still requires feature-level work for foreign keys, trigger behaviors, RLS policy replacements, SQL routines, UNIQUE/CHECK semantics, and query-specific index design. The previous D1 catalog audit found 82 indexes, zero foreign keys, and zero triggers. The migrated view is the only view currently in the D1 copy.

## Trigger function inventory

| Trigger function | Trigger count | Affected table(s) |
|---|---:|---|
| `capture_user_last_activity_from_usage_event` | 1 | usage_events |
| `enforce_immutable_kuro_id` | 1 | profiles |
| `enforce_temporary_account_suspension` | 41 | 41 user/game/social tables |
| `kuro_accumulate_win_score_insert` | 1 | game_scores |
| `kuro_accumulate_win_score_update` | 1 | game_scores |
| `kuro_coin_award_from_verified_game_event` | 1 | kuro_coin_verified_game_events |
| `kuro_coin_award_from_verified_tictactoe` | 1 | game_tictactoe_verified_events |
| `kuro_coin_award_from_verified_werewolf_score` | 1 | game_scores |
| `kuro_coin_award_from_win_event` | 1 | kuro_game_win_events |
| `kuro_coin_notify_reward` | 1 | kuro_coin_ledger |
| `kuro_coin_reward_from_sevens_result` | 1 | game_sevens_results |
| `kuro_enforce_account_suspension_write` | 50 | 25 social/admin/profile tables |
| `kuro_level_coin_reward_on_change` | 1 | kuro_level_users |
| `kuro_mark_verified_session_recovery_recorded` | 2 | game_verification_sessions |
| `kuro_notify_chat_message` | 1 | chat_messages |
| `kuro_notify_level_up` | 1 | kuro_level_users |
| `kuro_notify_post_like` | 1 | post_likes |
| `kuro_notify_post_reply` | 1 | post_replies |
| `kuro_sync_game_score_to_user_records` | 1 | game_scores |
| `kuro_sync_number_session_to_user_records` | 1 | game_verification_sessions |
| `kuro_sync_sevens_result_to_user_records` | 1 | game_sevens_results |
| `kuro_sync_tictactoe_event_to_user_records` | 1 | game_tictactoe_verified_events |
| `kuro_sync_werewolf_score_to_user_records` | 1 | game_scores |
| `kuro_sync_win_event_to_user_records` | 1 | kuro_game_win_events |
| `notify_portal_request_reply` | 1 | portal_requests |
| `sync_profile_username_alias` | 1 | profiles |
| `touch_account_suspension_appeal_activity` | 1 | account_suspension_appeal_messages |
| `werewolf_clear_chat_on_gameover` | 1 | werewolf_rooms |
| `werewolf_guard_room_update` | 1 | werewolf_rooms |

The two high-fan-out suspension guards account for 91 of the 119 trigger instances. They must be preserved before any write routing for the affected tables is switched.

## High-risk SECURITY DEFINER routine groups

### Game operations
- Daifugo: `kuro_daifugo_game_action`, `kuro_daifugo_game_start`, `kuro_daifugo_game_state`, and the matchmaking/ready routines.
- Sevens: `kuro_sevens_game_action`, `kuro_sevens_game_start`, `kuro_sevens_game_state`, `kuro_sevens_game_sync`, matchmaking, and room-vote routines.
- UNON: `kuro_unon_matchmaking_join/status/ack/cancel/try_match`.
- Werewolf: `kuro_werewolf_action`, `kuro_werewolf_join`, `kuro_werewolf_state`, `kuro_werewolf_sync_room`.
- Shared online-room join/leave and verified score submission routines.

### Economy and records
- KC award issuance, admin adjustments, and aggregate reporting.
- Verified game and win event reward triggers.
- XP/level adjustment, award, and recalculation.
- Score-to-user-record synchronization and notification side effects.

### Store and entitlements
- `kuro_store_purchase_item`, `kuro_store_discard_inventory_item`, studio membership/sales operations, and public cosmetics projection.
- Free-item claim and equipped-item operations also require explicit identity and ownership review.

### Account, security, and moderation
- New-user setup, IP-ban administration/check, username auth rate limiting, account suspension, and storage ownership lookup.

### SNS, chat, and notifications
- Chat/post notification functions, reply creation, and portal-request notifications.

## Migration requirements per routine

For each routine, record:
1. Public/Worker caller and exact input contract.
2. Identity source: user ID must come from a verified session, not an untrusted request body.
3. Authorization rule and the source RLS policy or admin gate it replaces.
4. Transaction boundary and every table written.
5. Idempotency behavior for retries and duplicate submissions.
6. Trigger side effects that must remain atomic.
7. Error mapping and audit-event behavior.
8. Positive, negative-authorization, concurrency, and rollback tests.

Do not port `SECURITY DEFINER` routines as ordinary SQL without preserving their access boundary. Do not split balances, game outcomes, rewards, or notification side effects across independently committed writes.

## Recommended order

1. Read-only views/projections and deterministic utilities with result-parity tests.
2. Low-risk public read endpoints with explicit visibility rules.
3. One write feature at a time, including its trigger effects, constraints, RLS replacement, transaction boundary, and idempotency.
4. Functional, negative-authorization, concurrency, and rollback tests in staging.
5. Only after a feature passes all checks, consider a guarded production traffic switch.

**Current status:** staging-only; production cutover prohibited.
