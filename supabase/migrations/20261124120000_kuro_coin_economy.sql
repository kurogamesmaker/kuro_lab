-- KURO COIN shared economy: account-wide balance, immutable ledger and verified-win rewards.
-- Historical wins are intentionally not backfilled; only new verified events earn KC.

create table if not exists public.kuro_coin_balances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.kuro_coin_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  transaction_type text not null check (transaction_type in ('game_win_reward','admin_adjustment','shop_purchase','shop_refund')),
  source_game_id uuid references public.game_studio_games(id) on delete set null,
  source_mode text,
  source_submission_id uuid,
  created_by_user_id uuid references auth.users(id) on delete set null,
  description text not null check (char_length(description) between 1 and 200),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 8192),
  created_at timestamptz not null default now()
);

create unique index if not exists kuro_coin_game_reward_once_idx
  on public.kuro_coin_ledger(user_id, source_game_id, source_submission_id)
  where transaction_type = 'game_win_reward'
    and source_game_id is not null
    and source_submission_id is not null;

create index if not exists kuro_coin_ledger_user_recent_idx
  on public.kuro_coin_ledger(user_id, created_at desc);

create table if not exists public.kuro_coin_game_rewards (
  game_id uuid not null references public.game_studio_games(id) on delete cascade,
  mode text not null check (mode ~ '^[A-Za-z0-9_-]{1,40}$'),
  reward_amount integer not null default 0 check (reward_amount between 0 and 1000),
  enabled boolean not null default false,
  required_cpu_difficulty text check (required_cpu_difficulty is null or required_cpu_difficulty in ('EASY','NORMAL','HARD','EXPERT')),
  reward_label text not null default 'ゲーム勝利報酬' check (char_length(reward_label) between 1 and 80),
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (game_id, mode)
);

alter table public.kuro_coin_balances enable row level security;
alter table public.kuro_coin_ledger enable row level security;
alter table public.kuro_coin_game_rewards enable row level security;

revoke all on table public.kuro_coin_balances, public.kuro_coin_ledger, public.kuro_coin_game_rewards
  from public, anon, authenticated;
grant select, insert, update, delete on table public.kuro_coin_balances, public.kuro_coin_ledger, public.kuro_coin_game_rewards
  to service_role;

comment on table public.kuro_coin_balances is 'KURO Lab共通KURO COIN残高。更新はサーバー専用処理のみ。';
comment on table public.kuro_coin_ledger is 'KURO COINの不変取引台帳。勝利報酬・管理補正・ショップ決済を記録。';
comment on table public.kuro_coin_game_rewards is 'サーバー検証済みゲーム勝利に対するKC報酬設定。初期値OFF。';

create or replace function public.kuro_coin_award_game_win(
  p_user_id uuid,
  p_game_id uuid,
  p_mode text,
  p_submission_id uuid,
  p_cpu_difficulty text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rule public.kuro_coin_game_rewards%rowtype;
  v_balance bigint;
  v_new_balance bigint;
  v_ledger_id uuid;
begin
  if p_user_id is null or p_game_id is null or p_submission_id is null then
    return false;
  end if;

  select * into v_rule
  from public.kuro_coin_game_rewards
  where game_id = p_game_id
    and mode = p_mode
    and enabled = true
    and reward_amount > 0;

  if not found then return false; end if;

  if v_rule.required_cpu_difficulty is not null
     and upper(coalesce(p_cpu_difficulty,'')) <> v_rule.required_cpu_difficulty then
    return false;
  end if;

  insert into public.kuro_coin_balances(user_id, balance)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select balance into v_balance
  from public.kuro_coin_balances
  where user_id = p_user_id
  for update;

  v_new_balance := v_balance + v_rule.reward_amount;

  insert into public.kuro_coin_ledger(
    user_id, amount, balance_after, transaction_type,
    source_game_id, source_mode, source_submission_id,
    description, metadata
  ) values (
    p_user_id, v_rule.reward_amount, v_new_balance, 'game_win_reward',
    p_game_id, p_mode, p_submission_id,
    v_rule.reward_label,
    jsonb_build_object('cpuDifficulty', upper(coalesce(p_cpu_difficulty,'')), 'source','verified-win-event')
  )
  on conflict do nothing
  returning id into v_ledger_id;

  if v_ledger_id is null then return false; end if;

  update public.kuro_coin_balances
  set balance = v_new_balance, updated_at = now()
  where user_id = p_user_id;

  return true;
end;
$function$;

revoke all on function public.kuro_coin_award_game_win(uuid,uuid,text,uuid,text)
  from public, anon, authenticated, service_role;

create or replace function public.kuro_coin_award_from_win_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform public.kuro_coin_award_game_win(
    new.user_id, new.game_id, new.mode, new.submission_id, new.cpu_difficulty
  );
  return new;
end;
$function$;

revoke all on function public.kuro_coin_award_from_win_event()
  from public, anon, authenticated, service_role;

drop trigger if exists kuro_coin_reward_from_verified_win on public.kuro_game_win_events;
create trigger kuro_coin_reward_from_verified_win
after insert on public.kuro_game_win_events
for each row execute function public.kuro_coin_award_from_win_event();

create or replace function public.kuro_coin_award_from_verified_tictactoe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.result = 'win' and upper(coalesce(new.cpu_difficulty,'')) = 'HARD' then
    perform public.kuro_coin_award_game_win(
      new.user_id, new.game_id, new.rule, new.submission_id, new.cpu_difficulty
    );
  end if;
  return new;
end;
$function$;

revoke all on function public.kuro_coin_award_from_verified_tictactoe()
  from public, anon, authenticated, service_role;

drop trigger if exists kuro_coin_reward_from_tictactoe on public.game_tictactoe_verified_events;
create trigger kuro_coin_reward_from_tictactoe
after insert on public.game_tictactoe_verified_events
for each row execute function public.kuro_coin_award_from_verified_tictactoe();

create or replace function public.kuro_coin_admin_adjust(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_actor_user_id uuid
) returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_balance bigint;
  v_new_balance bigint;
  v_reason text := btrim(coalesce(p_reason,''));
begin
  if p_user_id is null or p_actor_user_id is null then
    raise exception 'INVALID_COIN_ADJUSTMENT_USER';
  end if;
  if p_amount is null or p_amount = 0 or p_amount < -100000 or p_amount > 100000 then
    raise exception 'INVALID_COIN_ADJUSTMENT_AMOUNT';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 200 then
    raise exception 'INVALID_COIN_ADJUSTMENT_REASON';
  end if;

  insert into public.kuro_coin_balances(user_id, balance)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select balance into v_balance
  from public.kuro_coin_balances
  where user_id = p_user_id
  for update;

  v_new_balance := v_balance + p_amount;
  if v_new_balance < 0 then raise exception 'COIN_BALANCE_INSUFFICIENT'; end if;

  insert into public.kuro_coin_ledger(
    user_id, amount, balance_after, transaction_type,
    created_by_user_id, description, metadata
  ) values (
    p_user_id, p_amount, v_new_balance, 'admin_adjustment',
    p_actor_user_id, v_reason,
    jsonb_build_object('actorUserId', p_actor_user_id, 'reason', v_reason)
  );

  update public.kuro_coin_balances
  set balance = v_new_balance, updated_at = now()
  where user_id = p_user_id;

  return v_new_balance;
end;
$function$;

revoke all on function public.kuro_coin_admin_adjust(uuid,integer,text,uuid)
  from public, anon, authenticated;
grant execute on function public.kuro_coin_admin_adjust(uuid,integer,text,uuid)
  to service_role;

create or replace function public.kuro_coin_admin_overview()
returns table (
  total_balance bigint,
  total_issued bigint,
  total_spent bigint,
  funded_users bigint,
  transaction_count bigint
)
language sql
security definer
set search_path = ''
as $function$
  select
    coalesce((select sum(balance) from public.kuro_coin_balances),0)::bigint,
    coalesce((select sum(amount) from public.kuro_coin_ledger where amount > 0),0)::bigint,
    coalesce((select sum(-amount) from public.kuro_coin_ledger where amount < 0),0)::bigint,
    coalesce((select count(*) from public.kuro_coin_balances where balance > 0),0)::bigint,
    coalesce((select count(*) from public.kuro_coin_ledger),0)::bigint;
$function$;

revoke all on function public.kuro_coin_admin_overview()
  from public, anon, authenticated;
grant execute on function public.kuro_coin_admin_overview()
  to service_role;

-- Only new, server-verified victories earn rewards. No historical wins are replayed.
insert into public.kuro_coin_game_rewards
  (game_id, mode, reward_amount, enabled, required_cpu_difficulty, reward_label)
values
  ('2dbd6773-2684-4f00-973e-c46acbc348e7', 'normal', 5, true, 'HARD', '〇✕ゲーム（CPU最強）勝利'),
  ('2dbd6773-2684-4f00-973e-c46acbc348e7', 'vanish', 5, true, 'HARD', '〇✕ゲーム（CPU最強）勝利'),
  ('2dbd6773-2684-4f00-973e-c46acbc348e7', 'gobble', 5, true, 'HARD', '〇✕ゲーム（CPU最強）勝利'),
  ('2dbd6773-2684-4f00-973e-c46acbc348e7', 'reverse', 5, true, 'HARD', '〇✕ゲーム（CPU最強）勝利'),
  ('faa155cb-2143-4361-9a96-dc759d334e46', 'wins-online', 10, true, null, 'UNONオンライン勝利'),
  ('2eb37847-1b7e-43e4-ad98-901d5b830ac4', 'wins-online', 10, true, null, '大富豪オンライン勝利')
on conflict (game_id, mode) do nothing;
