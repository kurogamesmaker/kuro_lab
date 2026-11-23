-- KUROGAMES Werewolf: server-authoritative game state and private role storage.
-- Only kuro-games-online (service_role) can read or modify private sessions/actions.
create table if not exists public.werewolf_private_sessions (
  room_id uuid primary key references public.game_online_rooms(id) on delete cascade,
  game_id uuid not null references public.game_studio_games(id) on delete cascade,
  room_code text not null,
  private_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.werewolf_private_sessions enable row level security;
revoke all on public.werewolf_private_sessions from public, anon, authenticated;
grant all on public.werewolf_private_sessions to service_role;
create index if not exists werewolf_private_sessions_game_id_idx
  on public.werewolf_private_sessions(game_id);

create table if not exists public.werewolf_action_receipts (
  room_id uuid not null references public.game_online_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  action_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id, action_id)
);
alter table public.werewolf_action_receipts enable row level security;
revoke all on public.werewolf_action_receipts from public, anon, authenticated;
grant all on public.werewolf_action_receipts to service_role;
create index if not exists werewolf_action_receipts_user_id_idx
  on public.werewolf_action_receipts(user_id);

comment on table public.werewolf_private_sessions is
  'Server-only roles, secret votes, night actions and role-specific investigation results for the KUROGAMES Werewolf game.';
comment on table public.werewolf_action_receipts is
  'Idempotency ledger for server-validated Werewolf actions. Access is restricted to service_role.';

-- Legacy 4-digit browser-editable rooms are retired. New rooms use game_online_rooms + the common SDK.
drop policy if exists werewolf_room_member_read on public.werewolf_rooms;
drop policy if exists werewolf_room_member_update on public.werewolf_rooms;
drop policy if exists werewolf_room_host_create on public.werewolf_rooms;
drop policy if exists werewolf_room_host_delete on public.werewolf_rooms;
revoke all on public.werewolf_rooms from public, anon, authenticated;
revoke all on public.werewolf_chat_messages from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.kuro_werewolf_join(p_game_id uuid, p_room_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.game_online_rooms%rowtype;
  v_data jsonb;
  v_players jsonb;
  v_profile record;
  v_found boolean;
begin
  if p_game_id <> '903a4c45-37bb-4a4b-a259-a5a8245de998'::uuid then
    raise exception 'WEREWOLF_GAME_REQUIRED';
  end if;
  if not exists(select 1 from public.game_online_room_members m where m.room_id=p_room_id and m.user_id=p_user_id) then
    raise exception 'ROOM_MEMBERSHIP_REQUIRED';
  end if;
  select * into v_room from public.game_online_rooms
   where id=p_room_id and game_id=p_game_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;

  select p.kuro_id,p.username into v_profile
    from public.profiles p where p.id=p_user_id;
  if not found or coalesce(trim(v_profile.username),'')='' then
    raise exception 'ACCOUNT_NAME_REQUIRED';
  end if;

  v_data := coalesce(v_room.game_data,'{}'::jsonb);
  if v_room.game_data is null then
    if v_room.host_user_id <> p_user_id then raise exception 'HOST_ONLY_ACTION'; end if;
    v_data := jsonb_build_object(
      'roomId',v_room.room_code,
      'hostUid',p_user_id::text,
      'status','lobby',
      'createdAt',(extract(epoch from now())*1000)::bigint,
      'players',jsonb_build_array(jsonb_build_object(
        'uid',p_user_id::text,'kuroId',v_profile.kuro_id,
        'name',left(v_profile.username,24),'isAlive',true
      )),
      'rolesConfig',jsonb_build_object('werewolf',1,'seer',1,'guard',0,'medium',0,'madman',0),
      'gameState',null,
      'latestReaction',null
    );
  else
    if coalesce(v_data->>'status','lobby') <> 'lobby' then
      if exists(select 1 from jsonb_array_elements(coalesce(v_data->'players','[]'::jsonb)) p where p->>'uid'=p_user_id::text) then
        return v_data;
      end if;
      raise exception 'GAME_ALREADY_STARTED';
    end if;
    v_players := coalesce(v_data->'players','[]'::jsonb);
    select exists(select 1 from jsonb_array_elements(v_players) p where p->>'uid'=p_user_id::text) into v_found;
    if not v_found then
      if jsonb_array_length(v_players) >= least(v_room.max_players,35) then raise exception 'ROOM_FULL'; end if;
      v_players := v_players || jsonb_build_array(jsonb_build_object(
        'uid',p_user_id::text,'kuroId',v_profile.kuro_id,
        'name',left(v_profile.username,24),'isAlive',true
      ));
      v_data := jsonb_set(v_data,'{players}',v_players,true);
    end if;
  end if;

  update public.game_online_rooms
    set game_data=v_data,game_data_updated_at=now()
    where id=p_room_id;
  return v_data;
end;
$function$

CREATE OR REPLACE FUNCTION public.kuro_werewolf_state(p_game_id uuid, p_room_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.game_online_rooms%rowtype;
  v_session public.werewolf_private_sessions%rowtype;
  v_data jsonb;
  v_roles jsonb := '{}'::jsonb;
  v_private jsonb := '{}'::jsonb;
  v_gs jsonb;
  v_players jsonb;
  v_role text;
  v_status text;
begin
  if p_game_id <> '903a4c45-37bb-4a4b-a259-a5a8245de998'::uuid then raise exception 'WEREWOLF_GAME_REQUIRED'; end if;
  if not exists(select 1 from public.game_online_room_members m where m.room_id=p_room_id and m.user_id=p_user_id) then
    raise exception 'ROOM_MEMBERSHIP_REQUIRED';
  end if;
  select * into v_room from public.game_online_rooms where id=p_room_id and game_id=p_game_id;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  v_data := coalesce(v_room.game_data,'{}'::jsonb);
  v_status := coalesce(v_data->>'status','lobby');
  select * into v_session from public.werewolf_private_sessions where room_id=p_room_id;
  if found then
    v_private := v_session.private_state;
    v_roles := coalesce(v_private->'roles','{}'::jsonb);
  end if;
  v_role := v_roles->>p_user_id::text;

  select coalesce(jsonb_agg(
    case
      when v_status='gameover' then p.value || jsonb_build_object('role',coalesce(v_roles->>(p.value->>'uid'),'villager'))
      when p.value->>'uid'=p_user_id::text then p.value || jsonb_build_object('role',v_role)
      when v_role='werewolf' and v_roles->>(p.value->>'uid')='werewolf' then p.value || jsonb_build_object('role','werewolf')
      else p.value || jsonb_build_object('role',null)
    end order by p.ordinality
  ),'[]'::jsonb) into v_players
  from jsonb_array_elements(coalesce(v_data->'players','[]'::jsonb)) with ordinality p(value,ordinality);

  v_gs := coalesce(v_data->'gameState','{}'::jsonb);
  if jsonb_typeof(v_gs)='object' and v_session.room_id is not null then
    v_gs := v_gs || jsonb_build_object(
      'confirmedPlayers',coalesce(v_private->'confirmedPlayers','[]'::jsonb),
      'isTieVote',coalesce((v_private->>'isTieVote')::boolean,false),
      'votedCount',(select count(*) from jsonb_each(coalesce(v_private->'votes','{}'::jsonb)) e where exists(select 1 from jsonb_array_elements(coalesce(v_data->'players','[]'::jsonb)) p where p->>'uid'=e.key and coalesce((p->>'isAlive')::boolean,true))),
      'votes',case when coalesce(v_private->'votes','{}'::jsonb) ? p_user_id::text
        then jsonb_build_object(p_user_id::text,v_private->'votes'->p_user_id::text) else '{}'::jsonb end,
      'nightActions',jsonb_build_object(
        'werewolf',case when v_role='werewolf' then coalesce(v_private->'nightActions'->'werewolf','{}'::jsonb)
          when coalesce(v_private->'nightActions'->'werewolf','{}'::jsonb) ? p_user_id::text
            then jsonb_build_object(p_user_id::text,v_private->'nightActions'->'werewolf'->p_user_id::text)
          else '{}'::jsonb end,
        'seer',case when v_role='seer' and coalesce(v_private->'nightActions'->'seer','{}'::jsonb) ? p_user_id::text
          then jsonb_build_object(p_user_id::text,jsonb_build_object('targetUid',v_private->'nightActions'->'seer'->>p_user_id::text,'isWerewolf',(v_roles->>(v_private->'nightActions'->'seer'->>p_user_id::text))='werewolf')) else '{}'::jsonb end,
        'guard',case when v_role='guard' and coalesce(v_private->'nightActions'->'guard','{}'::jsonb) ? p_user_id::text
          then jsonb_build_object(p_user_id::text,v_private->'nightActions'->'guard'->p_user_id::text) else '{}'::jsonb end
      ),
      'seerLogs',coalesce((select jsonb_agg(l.value) from jsonb_array_elements(coalesce(v_private->'seerLogs','[]'::jsonb)) l(value)
        where l.value->>'seerUid'=p_user_id::text),'[]'::jsonb),
      'mediumLogs',case when v_role='medium' then coalesce(v_private->'mediumLogs','[]'::jsonb) else '[]'::jsonb end
    );
  end if;
  return v_data || jsonb_build_object('players',v_players,'gameState',case when v_data->'gameState' is null then null else v_gs end);
end;
$function$

CREATE OR REPLACE FUNCTION public.kuro_werewolf_action(p_game_id uuid, p_room_id uuid, p_user_id uuid, p_action text, p_payload jsonb, p_action_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.game_online_rooms%rowtype;
  v_data jsonb;
  v_players jsonb;
  v_gs jsonb;
  v_private jsonb;
  v_roles jsonb;
  v_role text;
  v_config jsonb;
  v_role_list text[] := array[]::text[];
  v_uid text;
  v_target text;
  v_round uuid;
  v_total integer;
  v_wolves integer;
  v_seers integer;
  v_guards integer;
  v_mediums integer;
  v_madmen integer;
  v_i integer;
  v_votes jsonb;
  v_night jsonb;
  v_seer_logs jsonb;
  v_medium_logs jsonb;
  v_alive integer;
  v_voted integer;
  v_counts jsonb;
  v_max integer;
  v_top_count integer;
  v_executed text;
  v_executed_player jsonb;
  v_victim text;
  v_victim_player jsonb;
  v_alive_wolves integer;
  v_alive_humans integer;
  v_winner text;
  v_reason text;
  v_new_players jsonb;
  v_candidates text[];
  v_record_count integer;
begin
  if p_game_id <> '903a4c45-37bb-4a4b-a259-a5a8245de998'::uuid then raise exception 'WEREWOLF_GAME_REQUIRED'; end if;
  if p_action_id is null then raise exception 'ACTION_ID_REQUIRED'; end if;
  if not exists(select 1 from public.game_online_room_members m where m.room_id=p_room_id and m.user_id=p_user_id) then
    raise exception 'ROOM_MEMBERSHIP_REQUIRED';
  end if;
  insert into public.werewolf_action_receipts(room_id,user_id,action_id)
    values(p_room_id,p_user_id,p_action_id) on conflict do nothing;
  get diagnostics v_record_count = row_count;
  select * into v_room from public.game_online_rooms where id=p_room_id and game_id=p_game_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_record_count=0 then
    return jsonb_build_object('ok',true,'duplicate',true,'state',public.kuro_werewolf_state(p_game_id,p_room_id,p_user_id));
  end if;
  v_data := coalesce(v_room.game_data,'{}'::jsonb);
  v_players := coalesce(v_data->'players','[]'::jsonb);
  if not exists(select 1 from jsonb_array_elements(v_players) p where p->>'uid'=p_user_id::text) then raise exception 'PLAYER_NOT_IN_GAME'; end if;

  if p_action='disband' then
    if v_room.host_user_id<>p_user_id then raise exception 'HOST_ONLY_ACTION'; end if;
    v_data:=v_data||jsonb_build_object('status','disbanded','players','[]'::jsonb,'gameState',null);
    delete from public.werewolf_private_sessions where room_id=p_room_id;
    update public.game_online_rooms set game_data=v_data,status='closed',game_data_updated_at=now() where id=p_room_id;
    return jsonb_build_object('ok',true,'state',public.kuro_werewolf_state(p_game_id,p_room_id,p_user_id));
  elsif p_action='set_config' then
    if v_room.host_user_id<>p_user_id then raise exception 'HOST_ONLY_ACTION'; end if;
    if coalesce(v_data->>'status','lobby')<>'lobby' then raise exception 'GAME_ALREADY_STARTED'; end if;
    v_config := coalesce(p_payload->'config','{}'::jsonb);
    v_config := jsonb_build_object(
      'werewolf',greatest(1,least(35,coalesce((v_config->>'werewolf')::integer,1))),
      'seer',greatest(0,least(35,coalesce((v_config->>'seer')::integer,1))),
      'guard',greatest(0,least(35,coalesce((v_config->>'guard')::integer,0))),
      'medium',greatest(0,least(35,coalesce((v_config->>'medium')::integer,0))),
      'madman',greatest(0,least(35,coalesce((v_config->>'madman')::integer,0)))
    );
    v_total := jsonb_array_length(v_players);
    if (select sum(value::text::integer) from jsonb_each(v_config)) > v_total then raise exception 'ROLE_COUNT_EXCEEDS_PLAYERS'; end if;
    v_data := jsonb_set(v_data,'{rolesConfig}',v_config,true);

  elsif p_action='reaction' then
    v_role := null;
    v_data := jsonb_set(v_data,'{latestReaction}',jsonb_build_object(
      'id',p_user_id::text||'_'||(extract(epoch from clock_timestamp())*1000)::bigint::text,
      'senderName',(select username from public.profiles where id=p_user_id),
      'emoji',left(coalesce(p_payload->>'emoji','✨'),8),
      'label',left(coalesce(p_payload->>'label','リアクション'),24),
      'ts',(extract(epoch from clock_timestamp())*1000)::bigint
    ),true);

  elsif p_action='start' then
    if v_room.host_user_id<>p_user_id then raise exception 'HOST_ONLY_ACTION'; end if;
    if coalesce(v_data->>'status','lobby')<>'lobby' then raise exception 'GAME_ALREADY_STARTED'; end if;
    v_total := jsonb_array_length(v_players);
    if v_total<3 then raise exception 'WEREWOLF_REQUIRES_THREE_PLAYERS'; end if;
    v_config := coalesce(v_data->'rolesConfig',jsonb_build_object('werewolf',1,'seer',1,'guard',0,'medium',0,'madman',0));
    v_wolves := greatest(1,coalesce((v_config->>'werewolf')::integer,1));
    v_seers := greatest(0,coalesce((v_config->>'seer')::integer,0));
    v_guards := greatest(0,coalesce((v_config->>'guard')::integer,0));
    v_mediums := greatest(0,coalesce((v_config->>'medium')::integer,0));
    v_madmen := greatest(0,coalesce((v_config->>'madman')::integer,0));
    if v_wolves+v_seers+v_guards+v_mediums+v_madmen>v_total then raise exception 'ROLE_COUNT_EXCEEDS_PLAYERS'; end if;
    for v_i in 1..v_wolves loop v_role_list:=array_append(v_role_list,'werewolf'); end loop;
    for v_i in 1..v_seers loop v_role_list:=array_append(v_role_list,'seer'); end loop;
    for v_i in 1..v_guards loop v_role_list:=array_append(v_role_list,'guard'); end loop;
    for v_i in 1..v_mediums loop v_role_list:=array_append(v_role_list,'medium'); end loop;
    for v_i in 1..v_madmen loop v_role_list:=array_append(v_role_list,'madman'); end loop;
    while coalesce(array_length(v_role_list,1),0)<v_total loop v_role_list:=array_append(v_role_list,'villager'); end loop;
    v_roles := '{}'::jsonb;
    v_i:=1;
    for v_uid in select p->>'uid' from jsonb_array_elements(v_players) p order by gen_random_uuid() loop
      v_target:=v_role_list[v_i];
      v_i:=v_i+1;
      v_roles:=jsonb_set(v_roles,array[v_uid],to_jsonb(v_target),true);
    end loop;
    v_round := gen_random_uuid();
    v_private := jsonb_build_object(
      'roles',v_roles,'votes','{}'::jsonb,'confirmedPlayers','[]'::jsonb,'isTieVote',false,
      'nightActions',jsonb_build_object('werewolf','{}'::jsonb,'seer','{}'::jsonb,'guard','{}'::jsonb),
      'seerLogs','[]'::jsonb,'mediumLogs','[]'::jsonb
    );
    insert into public.werewolf_private_sessions(room_id,game_id,room_code,private_state)
      values(p_room_id,p_game_id,v_room.room_code,v_private)
      on conflict(room_id) do update set game_id=excluded.game_id,room_code=excluded.room_code,private_state=excluded.private_state,updated_at=now();
    v_gs := jsonb_build_object('roundId',v_round,'day',1,'phase','role_check',
      'phaseStartedAt',(extract(epoch from clock_timestamp())*1000)::bigint,
      'discussDuration',180,'winner',null,'winReason','','lastVictim',null,'lastExecution',null,'votedCount',0);
    v_data := jsonb_set(v_data,'{status}',to_jsonb('playing'::text),true);
    v_data := jsonb_set(v_data,'{gameState}',v_gs,true);
    update public.game_online_rooms set status='playing' where id=p_room_id;

  else
    select private_state into v_private from public.werewolf_private_sessions where room_id=p_room_id for update;
    if not found then raise exception 'GAME_NOT_STARTED'; end if;
    v_roles := coalesce(v_private->'roles','{}'::jsonb);
    v_role := v_roles->>p_user_id::text;
    v_gs := coalesce(v_data->'gameState','{}'::jsonb);
    if coalesce(v_data->>'status','')<>'playing' then
      if p_action<>'return_to_lobby' then raise exception 'GAME_NOT_PLAYING'; end if;
    end if;

    if p_action='confirm_role' then
      if v_gs->>'phase'<>'role_check' then raise exception 'INVALID_PHASE'; end if;
      if not exists(select 1 from jsonb_array_elements(v_players) p where p->>'uid'=p_user_id::text and coalesce((p->>'isAlive')::boolean,true)) then raise exception 'PLAYER_DEAD'; end if;
      v_private:=jsonb_set(v_private,'{confirmedPlayers}',
        (select coalesce(jsonb_agg(x.uid),'[]'::jsonb) from (
          select distinct value as uid from jsonb_array_elements_text(coalesce(v_private->'confirmedPlayers','[]'::jsonb)) x(value)
          union select p_user_id::text
        ) x),true);
      if jsonb_array_length(v_private->'confirmedPlayers')>=jsonb_array_length(v_players) then
        v_gs:=v_gs||jsonb_build_object('phase','discuss','phaseStartedAt',(extract(epoch from clock_timestamp())*1000)::bigint);
      end if;

    elsif p_action='force_start_day1' then
      if v_room.host_user_id<>p_user_id then raise exception 'HOST_ONLY_ACTION'; end if;
      if v_gs->>'phase'<>'role_check' then raise exception 'INVALID_PHASE'; end if;
      v_gs:=v_gs||jsonb_build_object('phase','discuss','phaseStartedAt',(extract(epoch from clock_timestamp())*1000)::bigint);

    elsif p_action='adjust_discuss_time' then
      if v_room.host_user_id<>p_user_id then raise exception 'HOST_ONLY_ACTION'; end if;
      v_i:=greatest(60,least(600,coalesce((p_payload->>'duration')::integer,180)));
      v_gs:=jsonb_set(v_gs,'{discussDuration}',to_jsonb(v_i),true);

    elsif p_action='advance_vote' then
      if v_room.host_user_id<>p_user_id then raise exception 'HOST_ONLY_ACTION'; end if;
      if v_gs->>'phase'<>'discuss' then raise exception 'INVALID_PHASE'; end if;
      v_private:=jsonb_set(v_private,'{votes}','{}'::jsonb,true);
      v_private:=jsonb_set(v_private,'{isTieVote}','false'::jsonb,true);
      v_gs:=v_gs||jsonb_build_object('phase','vote','phaseStartedAt',(extract(epoch from clock_timestamp())*1000)::bigint,'votedCount',0);

    elsif p_action='submit_vote' or p_action='force_tally' then
      if v_gs->>'phase'<>'vote' then raise exception 'INVALID_PHASE'; end if;
      if p_action='force_tally' and v_room.host_user_id<>p_user_id then raise exception 'HOST_ONLY_ACTION'; end if;
      v_votes:=coalesce(v_private->'votes','{}'::jsonb);
      if p_action='submit_vote' then
        v_target:=p_payload->>'targetUid';
        if not exists(select 1 from jsonb_array_elements(v_players) p where p->>'uid'=p_user_id::text and coalesce((p->>'isAlive')::boolean,true)) then raise exception 'PLAYER_DEAD'; end if;
        if v_target is null or v_target=p_user_id::text or not exists(select 1 from jsonb_array_elements(v_players) p where p->>'uid'=v_target and coalesce((p->>'isAlive')::boolean,true)) then raise exception 'INVALID_VOTE_TARGET'; end if;
        v_votes:=jsonb_set(v_votes,array[p_user_id::text],to_jsonb(v_target),true);
        v_private:=jsonb_set(v_private,'{votes}',v_votes,true);
        select count(*) into v_alive from jsonb_array_elements(v_players) p where coalesce((p->>'isAlive')::boolean,true);
        select count(*) into v_voted from jsonb_each(v_votes) e where exists(select 1 from jsonb_array_elements(v_players) p where p->>'uid'=e.key and coalesce((p->>'isAlive')::boolean,true));
        v_gs:=jsonb_set(v_gs,'{votedCount}',to_jsonb(v_voted),true);
        if v_voted<v_alive then
          -- save state and return without revealing vote targets
          update public.werewolf_private_sessions set private_state=v_private,updated_at=now() where room_id=p_room_id;
          update public.game_online_rooms set game_data=v_data||jsonb_build_object('gameState',v_gs),game_data_updated_at=now() where id=p_room_id;

          return jsonb_build_object('ok',true,'state',public.kuro_werewolf_state(p_game_id,p_room_id,p_user_id));
        end if;
      end if;
      select coalesce(jsonb_object_agg(target_uid,votes_count),'{}'::jsonb) into v_counts
      from (
        select e.value as target_uid,count(*)::integer as votes_count
        from jsonb_each_text(v_votes) e
        where exists(select 1 from jsonb_array_elements(v_players) p where p->>'uid'=e.key and coalesce((p->>'isAlive')::boolean,true))
          and exists(select 1 from jsonb_array_elements(v_players) p where p->>'uid'=e.value and coalesce((p->>'isAlive')::boolean,true))
        group by e.value
      ) counts;
      if v_counts='{}'::jsonb then
        v_private:=jsonb_set(v_private,'{votes}','{}'::jsonb,true);
        v_private:=jsonb_set(v_private,'{isTieVote}','true'::jsonb,true);
        v_gs:=jsonb_set(v_gs,'{votedCount}',0::jsonb,true);
      else
        select max(value::text::integer) into v_max from jsonb_each(v_counts);
        select count(*) into v_top_count from jsonb_each(v_counts) where value::text::integer=v_max;
        if v_top_count>1 and coalesce((v_private->>'isTieVote')::boolean,false)=false then
          v_private:=jsonb_set(v_private,'{votes}','{}'::jsonb,true);
          v_private:=jsonb_set(v_private,'{isTieVote}','true'::jsonb,true);
          v_gs:=jsonb_set(v_gs,'{votedCount}',0::jsonb,true);
        else
          select array_agg(key order by gen_random_uuid()) into v_candidates from jsonb_each(v_counts) where value::text::integer=v_max;
          v_executed:=v_candidates[1];
          select p into v_executed_player from jsonb_array_elements(v_players) p where p->>'uid'=v_executed limit 1;
          select coalesce(jsonb_agg(case when p->>'uid'=v_executed then jsonb_set(p,'{isAlive}','false'::jsonb,true) else p end order by ord),'[]'::jsonb)
            into v_new_players from jsonb_array_elements(v_players) with ordinality x(p,ord);
          if v_executed_player is not null then
            v_medium_logs:=coalesce(v_private->'mediumLogs','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
              'day',coalesce((v_gs->>'day')::integer,1),'targetName',v_executed_player->>'name',
              'isWerewolf',(v_roles->>v_executed)='werewolf'));
            v_private:=jsonb_set(v_private,'{mediumLogs}',v_medium_logs,true);
          end if;
          v_private:=jsonb_set(v_private,'{votes}','{}'::jsonb,true);
          v_private:=jsonb_set(v_private,'{isTieVote}','false'::jsonb,true);
          select count(*) filter(where (v_roles->>(p->>'uid'))='werewolf'),
                 count(*) filter(where (v_roles->>(p->>'uid'))<>'werewolf')
            into v_alive_wolves,v_alive_humans
            from jsonb_array_elements(v_new_players) p where coalesce((p->>'isAlive')::boolean,true);
          if v_alive_wolves=0 then v_winner:='villagers';v_reason:='すべての人狼を処刑し、村に平和が戻りました！';
          elsif v_alive_wolves>=v_alive_humans then v_winner:='werewolves';v_reason:='生存している人狼の数が人間と同数以上になり、村は制圧されました！';
          end if;
          v_players:=v_new_players;
          v_gs:=v_gs||jsonb_build_object('lastExecution',jsonb_build_object('uid',v_executed,'name',v_executed_player->>'name'),'votedCount',0);
          if v_winner is not null then
            v_gs:=v_gs||jsonb_build_object('phase','gameover','winner',v_winner,'winReason',v_reason);
            v_data:=v_data||jsonb_build_object('status','gameover','players',v_players,'gameState',v_gs);
            update public.game_online_rooms set status='waiting' where id=p_room_id;
            v_round:=nullif(v_gs->>'roundId','')::uuid;
            for v_uid in select p->>'uid' from jsonb_array_elements(v_players) p
              where ((v_roles->>(p->>'uid'))='werewolf')=(v_winner='werewolves')
            loop
              begin
                perform * from public.kuro_submit_game_score(p_game_id,v_uid::uuid,
                  case when v_winner='werewolves' then 'werewolf_wolf_wins' else 'werewolf_villager_wins' end,
                  1,v_round,jsonb_build_object('source','server-validated-werewolf'),null,null);
              exception when unique_violation then null;
              end;
            end loop;
          else
            v_gs:=v_gs||jsonb_build_object('phase','night','phaseStartedAt',(extract(epoch from clock_timestamp())*1000)::bigint);
            v_private:=jsonb_set(v_private,'{nightActions}',jsonb_build_object('werewolf','{}'::jsonb,'seer','{}'::jsonb,'guard','{}'::jsonb),true);
            v_data:=v_data||jsonb_build_object('players',v_players,'gameState',v_gs);
          end if;
        end if;
      end if;

    elsif p_action='night_action' or p_action='force_finish_night' then
      if v_gs->>'phase'<>'night' then raise exception 'INVALID_PHASE'; end if;
      if p_action='force_finish_night' and v_room.host_user_id<>p_user_id then raise exception 'HOST_ONLY_ACTION'; end if;
      v_night:=coalesce(v_private->'nightActions',jsonb_build_object('werewolf','{}'::jsonb,'seer','{}'::jsonb,'guard','{}'::jsonb));
      if p_action='night_action' then
        if not exists(select 1 from jsonb_array_elements(v_players) p where p->>'uid'=p_user_id::text and coalesce((p->>'isAlive')::boolean,true)) then raise exception 'PLAYER_DEAD'; end if;
        v_target:=p_payload->>'targetUid';
        if v_role not in ('werewolf','seer','guard') then raise exception 'ROLE_CANNOT_ACT'; end if;
        if v_target is null or not exists(select 1 from jsonb_array_elements(v_players) p where p->>'uid'=v_target and coalesce((p->>'isAlive')::boolean,true)) then raise exception 'INVALID_NIGHT_TARGET'; end if;
        if v_role='werewolf' and (v_roles->>v_target)='werewolf' then raise exception 'INVALID_NIGHT_TARGET'; end if;
        if v_role in ('seer','guard') and v_target=p_user_id::text then raise exception 'INVALID_NIGHT_TARGET'; end if;
        if v_role='seer' and coalesce(v_night->'seer','{}'::jsonb) ? p_user_id::text then raise exception 'ALREADY_ACTED'; end if;
        v_night:=jsonb_set(v_night,array[v_role],jsonb_set(coalesce(v_night->v_role,'{}'::jsonb),array[p_user_id::text],to_jsonb(v_target),true),true);
        if v_role='seer' then
          v_seer_logs:=coalesce(v_private->'seerLogs','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
            'day',coalesce((v_gs->>'day')::integer,1),'seerUid',p_user_id::text,
            'targetName',(select p->>'name' from jsonb_array_elements(v_players) p where p->>'uid'=v_target),
            'isWerewolf',(v_roles->>v_target)='werewolf'));
          v_private:=jsonb_set(v_private,'{seerLogs}',v_seer_logs,true);
        end if;
        v_private:=jsonb_set(v_private,'{nightActions}',v_night,true);
      end if;

      select count(*) into v_alive from jsonb_array_elements(v_players) p
        where coalesce((p->>'isAlive')::boolean,true) and (v_roles->>(p->>'uid')) in ('werewolf','seer','guard');
      select count(*) into v_voted from jsonb_array_elements(v_players) p
        where coalesce((p->>'isAlive')::boolean,true) and (
          ((v_roles->>(p->>'uid'))='werewolf' and (v_night->'werewolf') ? (p->>'uid')) or
          ((v_roles->>(p->>'uid'))='seer' and (v_night->'seer') ? (p->>'uid')) or
          ((v_roles->>(p->>'uid'))='guard' and (v_night->'guard') ? (p->>'uid'))
        );
      if p_action='force_finish_night' or v_voted>=v_alive then
        v_candidates:=array[]::text[];
        select array_agg(e.value order by gen_random_uuid()) into v_candidates
        from jsonb_each_text(coalesce(v_night->'werewolf','{}'::jsonb)) e
        where exists(select 1 from jsonb_array_elements(v_players) p where p->>'uid'=e.key and coalesce((p->>'isAlive')::boolean,true) and (v_roles->>e.key)='werewolf')
          and exists(select 1 from jsonb_array_elements(v_players) p where p->>'uid'=e.value and coalesce((p->>'isAlive')::boolean,true) and (v_roles->>e.value)<>'werewolf');
        v_victim:=null;
        if coalesce(array_length(v_candidates,1),0)>0 then
          -- Werewolf choices are resolved by the most common target; ties are random.
          select array_agg(target_uid order by gen_random_uuid()) into v_candidates from (
            select e.value target_uid,count(*) c from jsonb_each_text(coalesce(v_night->'werewolf','{}'::jsonb)) e
            where exists(select 1 from jsonb_array_elements(v_players) p where p->>'uid'=e.key and coalesce((p->>'isAlive')::boolean,true) and (v_roles->>e.key)='werewolf')
            group by e.value
          ) x where c=(select max(counted) from (select count(*) counted from jsonb_each_text(coalesce(v_night->'werewolf','{}'::jsonb)) group by value) mx);
          v_victim:=v_candidates[1];
        end if;
        if v_victim is not null and exists(select 1 from jsonb_each_text(coalesce(v_night->'guard','{}'::jsonb)) g where g.value=v_victim) then v_victim:=null; end if;
        select p into v_victim_player from jsonb_array_elements(v_players) p where p->>'uid'=v_victim limit 1;
        if v_victim is not null then
          select coalesce(jsonb_agg(case when p->>'uid'=v_victim then jsonb_set(p,'{isAlive}','false'::jsonb,true) else p end order by ord),'[]'::jsonb)
            into v_new_players from jsonb_array_elements(v_players) with ordinality x(p,ord);
          v_players:=v_new_players;
        end if;
        select count(*) filter(where (v_roles->>(p->>'uid'))='werewolf'),
               count(*) filter(where (v_roles->>(p->>'uid'))<>'werewolf')
          into v_alive_wolves,v_alive_humans from jsonb_array_elements(v_players) p where coalesce((p->>'isAlive')::boolean,true);
        if v_alive_wolves=0 then v_winner:='villagers';v_reason:='すべての人狼を排除し、村に平和が戻りました！';
        elsif v_alive_wolves>=v_alive_humans then v_winner:='werewolves';v_reason:='生存している人狼の数が人間と同数以上になり、村は制圧されました！';
        else v_winner:=null; end if;
        v_gs:=v_gs||jsonb_build_object(
          'day',coalesce((v_gs->>'day')::integer,1)+1,
          'lastVictim',case when v_victim is null then null else jsonb_build_object('uid',v_victim,'name',v_victim_player->>'name') end,
          'phaseStartedAt',(extract(epoch from clock_timestamp())*1000)::bigint
        );
        if v_winner is not null then
          v_gs:=v_gs||jsonb_build_object('phase','gameover','winner',v_winner,'winReason',v_reason);
          v_data:=v_data||jsonb_build_object('status','gameover','players',v_players,'gameState',v_gs);
          update public.game_online_rooms set status='waiting' where id=p_room_id;
          v_round:=nullif(v_gs->>'roundId','')::uuid;
          for v_uid in select p->>'uid' from jsonb_array_elements(v_players) p
            where ((v_roles->>(p->>'uid'))='werewolf')=(v_winner='werewolves')
          loop
            begin
              perform * from public.kuro_submit_game_score(p_game_id,v_uid::uuid,
                case when v_winner='werewolves' then 'werewolf_wolf_wins' else 'werewolf_villager_wins' end,
                1,v_round,jsonb_build_object('source','server-validated-werewolf'),null,null);
            exception when unique_violation then null;
            end;
          end loop;
        else
          v_gs:=v_gs||jsonb_build_object('phase','discuss');
          v_private:=jsonb_set(v_private,'{votes}','{}'::jsonb,true);
          v_private:=jsonb_set(v_private,'{isTieVote}','false'::jsonb,true);
          v_private:=jsonb_set(v_private,'{nightActions}',jsonb_build_object('werewolf','{}'::jsonb,'seer','{}'::jsonb,'guard','{}'::jsonb),true);
          v_data:=v_data||jsonb_build_object('players',v_players,'gameState',v_gs);
        end if;
      end if;
    elsif p_action='return_to_lobby' then
      if v_room.host_user_id<>p_user_id then raise exception 'HOST_ONLY_ACTION'; end if;
      if v_data->>'status'<>'gameover' then raise exception 'GAME_NOT_FINISHED'; end if;
      delete from public.werewolf_private_sessions where room_id=p_room_id;
      v_players := (select coalesce(jsonb_agg(jsonb_build_object(
        'uid',p->>'uid','kuroId',p->'kuroId','name',p->>'name','isAlive',true
      ) order by ord),'[]'::jsonb) from jsonb_array_elements(v_players) with ordinality x(p,ord));
      v_gs:=null; v_data:=v_data||jsonb_build_object('status','lobby','players',v_players,'gameState',null);

    else
      raise exception 'UNKNOWN_WEREWOLF_ACTION';
    end if;
    if p_action not in ('return_to_lobby','disband') then
      update public.werewolf_private_sessions set private_state=v_private,updated_at=now() where room_id=p_room_id;
    end if;
    if v_gs is not null then v_data:=v_data||jsonb_build_object('gameState',v_gs); end if;
  end if;

  update public.game_online_rooms set game_data=v_data,game_data_updated_at=now() where id=p_room_id;

  return jsonb_build_object('ok',true,'state',public.kuro_werewolf_state(p_game_id,p_room_id,p_user_id));
end;
$function$

CREATE OR REPLACE FUNCTION public.kuro_werewolf_sync_room(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.game_online_rooms%rowtype;
  v_data jsonb;
  v_players jsonb;
begin
  select * into v_room from public.game_online_rooms where id=p_room_id for update;
  if not found then return jsonb_build_object('missing',true); end if;
  if v_room.game_id<>'903a4c45-37bb-4a4b-a259-a5a8245de998'::uuid then return jsonb_build_object('ignored',true); end if;
  v_data:=coalesce(v_room.game_data,'{}'::jsonb);
  select coalesce(jsonb_agg(
    jsonb_build_object('uid',m.user_id::text,'kuroId',p.kuro_id,'name',left(p.username,24),
      'isAlive',coalesce((oldp.value->>'isAlive')::boolean,true))
    order by m.joined_at
  ),'[]'::jsonb) into v_players
  from public.game_online_room_members m
  join public.profiles p on p.id=m.user_id
  left join lateral (
    select x.value from jsonb_array_elements(coalesce(v_data->'players','[]'::jsonb)) x(value)
    where x.value->>'uid'=m.user_id::text limit 1
  ) oldp on true
  where m.room_id=p_room_id;
  if jsonb_array_length(v_players)=0 then
    v_data:=v_data||jsonb_build_object('status','disbanded','players','[]'::jsonb,'gameState',null);
    delete from public.werewolf_private_sessions where room_id=p_room_id;
  else
    v_data:=v_data||jsonb_build_object('players',v_players,'hostUid',v_room.host_user_id::text);
  end if;
  update public.game_online_rooms set game_data=v_data,game_data_updated_at=now() where id=p_room_id;
  return v_data;
end;
$function$

revoke all on function public.kuro_werewolf_join(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.kuro_werewolf_state(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.kuro_werewolf_action(uuid,uuid,uuid,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.kuro_werewolf_sync_room(uuid) from public, anon, authenticated;
grant execute on function public.kuro_werewolf_join(uuid,uuid,uuid) to service_role;
grant execute on function public.kuro_werewolf_state(uuid,uuid,uuid) to service_role;
grant execute on function public.kuro_werewolf_action(uuid,uuid,uuid,text,jsonb,uuid) to service_role;
grant execute on function public.kuro_werewolf_sync_room(uuid) to service_role;

-- Disable legacy RPC endpoints that used the old shared 4-digit room table.
revoke all on function public.werewolf_join_room(text,text) from public, anon, authenticated;
revoke all on function public.werewolf_update_room(text,jsonb,timestamptz,boolean) from public, anon, authenticated;
