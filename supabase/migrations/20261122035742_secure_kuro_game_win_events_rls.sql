-- Secure the internal win-event ledger without changing the score-writing path.
-- The table is only written by SECURITY DEFINER triggers owned by postgres
-- and server-side service_role code; no end-user table access is required.

alter table public.kuro_game_win_events enable row level security;

revoke all on table public.kuro_game_win_events
  from public, anon, authenticated;

grant select, insert, update, delete on table public.kuro_game_win_events
  to service_role;

comment on table public.kuro_game_win_events is
  'Internal idempotency ledger for win-score accumulation. Access is restricted to service_role and postgres-owned SECURITY DEFINER triggers.';
