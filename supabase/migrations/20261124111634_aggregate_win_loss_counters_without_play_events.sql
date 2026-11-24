-- Aggregate-only win/loss counters. No per-play event rows are created.
-- The shared helper deduplicates submission IDs and increments one user/game/mode row.
CREATE OR REPLACE FUNCTION public.kuro_daifugo_game_action(p_game_id uuid, p_room_id uuid, p_user_id uuid, p_action text, p_card_ids integer[] DEFAULT ARRAY[]::integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.game_daifugo_private_sessions;
  v_state jsonb;
  v_public jsonb;
  v_hands jsonb;
  v_hand jsonb;
  v_new_hand jsonb;
  v_cards jsonb := '[]'::jsonb;
  v_card jsonb;
  v_previous jsonb;
  v_previous_card jsonb;
  v_order uuid[];
  v_other uuid;
  v_user_text text := p_user_id::text;
  v_count integer;
  v_found_count integer;
  v_joker_count integer;
  v_natural_count integer;
  v_base_rank integer;
  v_max_rank integer;
  v_combo_rank numeric;
  v_previous_rank numeric;
  v_previous_count integer;
  v_previous_joker boolean;
  v_beats boolean := true;
  v_next uuid;
  v_leader uuid;
  v_passed jsonb;
  v_finish jsonb;
  v_players jsonb := '[]'::jsonb;
  v_player uuid;
  v_player_hand jsonb;
  v_player_count integer;
  v_message text;
  v_revolution boolean;
  v_eight boolean;
  v_spade3 boolean;
  v_has_eight boolean := false;
begin
  if p_action not in ('play','pass') then raise exception 'DAIFUGO_INVALID_ACTION'; end if;
  if not exists(
    select 1 from public.game_online_room_members
    where room_id=p_room_id and user_id=p_user_id
  ) then raise exception 'ROOM_MEMBERSHIP_REQUIRED'; end if;

  select * into v_session
  from public.game_daifugo_private_sessions
  where room_id=p_room_id and game_id=p_game_id
  for update;
  if not found then raise exception 'DAIFUGO_GAME_NOT_STARTED'; end if;

  v_state := v_session.session_state;
  v_public := v_state->'public';
  if v_public->>'phase' <> 'playing' then raise exception 'DAIFUGO_GAME_FINISHED'; end if;
  if v_public->>'currentUserId' <> v_user_text then raise exception 'DAIFUGO_NOT_YOUR_TURN'; end if;

  v_hands := coalesce(v_state->'hands','{}'::jsonb);
  v_hand := coalesce(v_hands->v_user_text,'[]'::jsonb);
  v_order := array(select jsonb_array_elements_text(v_state->'playerOrder')::uuid);
  v_revolution := coalesce((v_public->>'revolution')::boolean,false);
  v_eight := coalesce((v_public->'rules'->>'eight')::boolean,false);
  v_spade3 := coalesce((v_public->'rules'->>'spade3')::boolean,false);

  if p_action='play' then
    if coalesce(array_length(p_card_ids,1),0)<1 or coalesce(array_length(p_card_ids,1),0)>4 then
      raise exception 'DAIFUGO_INVALID_CARD_COUNT';
    end if;
    if (select count(distinct id) from unnest(p_card_ids) as ids(id)) <> array_length(p_card_ids,1) then
      raise exception 'DAIFUGO_DUPLICATE_CARD';
    end if;

    select count(*),coalesce(jsonb_agg(item.card order by item.ord),'[]'::jsonb)
    into v_found_count,v_cards
    from jsonb_array_elements(v_hand) with ordinality as item(card,ord)
    where (item.card->>'id')::integer = any(p_card_ids);
    if v_found_count <> array_length(p_card_ids,1) then raise exception 'DAIFUGO_CARD_NOT_IN_HAND'; end if;

    v_count := jsonb_array_length(v_cards);
    select
      count(*) filter(where coalesce((item.card->>'joker')::boolean,false)),
      count(*) filter(where not coalesce((item.card->>'joker')::boolean,false)),
      min((item.card->>'rank')::integer) filter(where not coalesce((item.card->>'joker')::boolean,false)),
      max((item.card->>'rank')::integer) filter(where not coalesce((item.card->>'joker')::boolean,false)),
      bool_or(not coalesce((item.card->>'joker')::boolean,false) and (item.card->>'rank')::integer=8)
    into v_joker_count,v_natural_count,v_base_rank,v_max_rank,v_has_eight
    from jsonb_array_elements(v_cards) as item(card);

    if v_count>1 and (v_natural_count=0 or v_joker_count>1 or v_base_rank<>v_max_rank) then
      raise exception 'DAIFUGO_INVALID_COMBINATION';
    end if;

    if v_count=1 then
      select item.card into v_card from jsonb_array_elements(v_cards) as item(card);
      v_combo_rank := case when coalesce((v_card->>'joker')::boolean,false) then 16 else (v_card->>'rank')::numeric end;
    else
      v_combo_rank := v_base_rank + case when v_joker_count>0 then 0.01 else 0 end;
    end if;

    v_previous := v_public->'lastPlay';
    if v_previous is not null and v_previous <> 'null'::jsonb then
      v_previous_count := (v_previous->>'count')::integer;
      if v_previous_count<>v_count then raise exception 'DAIFUGO_WRONG_CARD_COUNT'; end if;

      v_previous_card := v_previous->'cards'->0;
      v_previous_joker := coalesce((v_previous_card->>'joker')::boolean,false) and v_previous_count=1;

      if v_count=1 and v_previous_joker and v_spade3 and exists(
        select 1
        from jsonb_array_elements(v_cards) as item(card)
        where item.card->>'suit'='♠' and (item.card->>'rank')::integer=3
      ) then
        v_beats := true;
      elsif v_count=1 and v_joker_count=1 then
        v_beats := not v_previous_joker;
      elsif v_previous_joker then
        v_beats := false;
      else
        v_previous_rank := (v_previous->>'comboRank')::numeric;
        v_beats := case when v_revolution then v_combo_rank < v_previous_rank else v_combo_rank > v_previous_rank end;
      end if;
      if not v_beats then raise exception 'DAIFUGO_CARD_NOT_STRONG_ENOUGH'; end if;
    end if;

    select coalesce(jsonb_agg(item.card order by item.ord),'[]'::jsonb)
    into v_new_hand
    from jsonb_array_elements(v_hand) with ordinality as item(card,ord)
    where not ((item.card->>'id')::integer=any(p_card_ids));

    v_hands := jsonb_set(v_state->'hands',array[v_user_text],v_new_hand,true);
    v_finish := coalesce(v_public->'finishOrder','[]'::jsonb);
    if jsonb_array_length(v_new_hand)=0 then
      v_finish := v_finish || jsonb_build_array(p_user_id);
      v_message := 'プレイヤーが上がりました！';
    else
      v_message := 'カードが出されました。';
    end if;

    if v_public->'rules'->>'revolution'='true' and v_count=4 then
      v_revolution := not v_revolution;
      v_message := v_message || ' 革命！';
    end if;

    v_public := jsonb_set(v_public,'{firstMove}','false'::jsonb,true);
    v_public := jsonb_set(v_public,'{lastPlay}',jsonb_build_object(
      'userId',p_user_id,
      'cards',v_cards,
      'count',v_count,
      'comboRank',v_combo_rank,
      'hasJoker',v_joker_count>0
    ),true);
    v_public := jsonb_set(v_public,'{passedUserIds}','[]'::jsonb,true);
    v_public := jsonb_set(v_public,'{revolution}',to_jsonb(v_revolution),true);
    v_public := jsonb_set(v_public,'{finishOrder}',v_finish,true);

    if jsonb_array_length(v_finish)>=1 then
      v_other := case when v_order[1]=p_user_id then v_order[2] else v_order[1] end;
      if not (v_finish @> jsonb_build_array(v_other)) then v_finish := v_finish || jsonb_build_array(v_other); end if;
      v_public := jsonb_set(v_public,'{finishOrder}',v_finish,true);
      v_public := jsonb_set(v_public,'{phase}','"finished"'::jsonb,true);
      v_public := jsonb_set(v_public,'{currentUserId}','null'::jsonb,true);
      v_public := jsonb_set(v_public,'{message}',to_jsonb(v_message || ' 対戦終了！'),true);
      -- The server is the authority for online match results.
      -- A room hosts only one Daifugo match, so room_id is a stable idempotency key.
      PERFORM 1
      FROM public.kuro_submit_game_score(
        p_game_id,
        (v_finish->>0)::uuid,
        'wins-online',
        1,
        p_room_id,
        jsonb_build_object(
          'metric','wins',
          'game','daifugo',
          'opponentMode','online',
          'roomId',p_room_id
        )
      );

      -- Record the other player's loss in the same compact per-mode aggregate.
      PERFORM public.kuro_record_user_game_event(
        p_room_id,
        (v_finish->>1)::uuid,
        p_game_id,
        'wins-online',
        'loss',
        null,
        null,
        jsonb_build_object(
          'source','daifugo-server',
          'serverVerified',true,
          'roomId',p_room_id
        )
      );
    elsif v_eight and v_has_eight then
      v_public := jsonb_set(v_public,'{lastPlay}','null'::jsonb,true);
      v_public := jsonb_set(v_public,'{passedUserIds}','[]'::jsonb,true);
      v_public := jsonb_set(v_public,'{currentUserId}',to_jsonb(p_user_id),true);
      v_public := jsonb_set(v_public,'{message}',to_jsonb(v_message || ' 8切り！場が流れました。'),true);
    else
      v_other := case when v_order[1]=p_user_id then v_order[2] else v_order[1] end;
      if jsonb_array_length(coalesce(v_hands->v_other::text,'[]'::jsonb))>0 then
        v_next := v_other;
      else
        v_next := p_user_id;
      end if;
      v_public := jsonb_set(v_public,'{currentUserId}',to_jsonb(v_next),true);
      v_public := jsonb_set(v_public,'{message}',to_jsonb(v_message),true);
    end if;

  else
    if v_public->'lastPlay' is null or v_public->'lastPlay'='null'::jsonb then
      raise exception 'DAIFUGO_CANNOT_PASS_ON_EMPTY_TABLE';
    end if;
    v_leader := (v_public->'lastPlay'->>'userId')::uuid;
    v_passed := coalesce(v_public->'passedUserIds','[]'::jsonb);
    if not (v_passed @> jsonb_build_array(p_user_id)) then
      v_passed:=v_passed || jsonb_build_array(p_user_id);
    end if;

    v_other := case when v_order[1]=p_user_id then v_order[2] else v_order[1] end;
    if v_other=v_leader or jsonb_array_length(coalesce(v_hands->v_other::text,'[]'::jsonb))=0 then
      v_public:=jsonb_set(v_public,'{lastPlay}','null'::jsonb,true);
      v_public:=jsonb_set(v_public,'{passedUserIds}','[]'::jsonb,true);
      if jsonb_array_length(coalesce(v_hands->v_leader::text,'[]'::jsonb))>0 then
        v_next:=v_leader;
      else
        v_next:=v_other;
      end if;
      v_public:=jsonb_set(v_public,'{currentUserId}',to_jsonb(v_next),true);
      v_message:='全員がパス。場が流れました！';
    else
      v_public:=jsonb_set(v_public,'{passedUserIds}',v_passed,true);
      v_public:=jsonb_set(v_public,'{currentUserId}',to_jsonb(v_other),true);
      v_message:='パスしました。';
    end if;
    v_public:=jsonb_set(v_public,'{message}',to_jsonb(v_message),true);
  end if;

  v_players := '[]'::jsonb;
  for v_card in
    select item.player
    from jsonb_array_elements(v_public->'players') as item(player)
  loop
    v_player := (v_card->>'userId')::uuid;
    v_player_hand := coalesce(v_hands->v_player::text,'[]'::jsonb);
    v_player_count := jsonb_array_length(v_player_hand);
    v_players := v_players || jsonb_build_array(
      jsonb_set(v_card,'{cardCount}',to_jsonb(v_player_count),true)
    );
  end loop;
  v_public:=jsonb_set(v_public,'{players}',v_players,true);

  v_state:=jsonb_set(v_state,'{hands}',v_hands,true);
  v_state:=jsonb_set(v_state,'{public}',v_public,true);

  update public.game_daifugo_private_sessions
  set session_state=v_state,version=version+1,updated_at=now()
  where room_id=p_room_id;

  update public.game_online_room_members
  set last_seen_at=now()
  where room_id=p_room_id and user_id=p_user_id;

  return jsonb_build_object(
    'ok',true,
    'publicState',v_public,
    'hand',coalesce(v_hands->v_user_text,'[]'::jsonb),
    'version',(select version from public.game_daifugo_private_sessions where room_id=p_room_id)
  );
end;
$function$
;

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

            -- Store losses for the opposing faction without creating per-player event rows.
            for v_uid in select p->>'uid' from jsonb_array_elements(v_players) p
              where ((v_roles->>(p->>'uid'))='werewolf')<>(v_winner='werewolves')
            loop
              perform public.kuro_record_user_game_event(
                v_round,
                v_uid::uuid,
                p_game_id,
                case when (v_roles->>v_uid)='werewolf'
                  then 'werewolf_wolf_wins' else 'werewolf_villager_wins' end,
                'loss',
                null,
                null,
                pg_catalog.jsonb_build_object(
                  'metric','wins',
                  'source','werewolf-server',
                  'serverVerified',true,
                  'roundId',v_round
                )
              );
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
;

CREATE OR REPLACE FUNCTION public.kuro_sync_number_session_to_user_records()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_play_mode text;
  v_level text;
  v_mode text;
  v_result text;
  v_elapsed bigint;
  v_is_time boolean;
  v_valid_time boolean;
begin
  if new.game_type <> 'number_guess'
    or new.status <> 'completed'
    or new.result not in ('correct','failed') then
    return new;
  end if;

  v_play_mode := coalesce(new.state->>'playMode','');
  v_level := lower(coalesce(new.state->>'level',''));
  if v_play_mode not in ('classic','time')
    or v_level not in ('easy','normal','hard','expert','master','legend') then
    return new;
  end if;
  v_is_time := v_play_mode='time';
  v_elapsed := greatest(0,floor(extract(epoch from (
    coalesce(new.completed_at,pg_catalog.now()) - new.started_at
  )) * 1000)::bigint);
  v_valid_time := v_is_time and new.result='correct' and v_elapsed between 500 and 3600000;
  v_mode := 'number-' || v_play_mode || '-' || v_level;
  v_result := case when new.result='correct' then 'win' else 'loss' end;

  perform public.kuro_record_user_game_event(
    new.id,
    new.user_id,
    new.game_id,
    v_mode,
    v_result,
    case when v_valid_time then v_elapsed else null end,
    case when v_is_time and not v_valid_time then null else v_elapsed end,
    pg_catalog.jsonb_build_object(
      'source','number-guess-server',
      'serverVerified',true,
      'metric',case when v_valid_time then 'clear_time_ms' else 'completion' end,
      'verifiedRanking',case when v_valid_time then 'number-guess-v1' else null end,
      'difficulty',v_level,
      'rangeMax',new.range_max,
      'attempts',new.attempts
    )
  );
  return new;
end;
$function$
;

-- UNON online losers receive per-user signed loss proofs from the room Worker.
update public.game_studio_games
set html_content=replace(replace(replace(replace(replace(replace(html_content,$$let snapshotPublic=null,snapshotPrivate=null,snapshotWinProof=null,snapshotMatchId=null,snapshotVersion=-1,patchChain=Promise.resolve();$$,$$let snapshotPublic=null,snapshotPrivate=null,snapshotWinProof=null,snapshotLossProof=null,snapshotMatchId=null,snapshotVersion=-1,patchChain=Promise.resolve();$$),$$const onlineWinRecorded=new Set(),onlineWinPending=new Set(),onlineWinRefreshPending=new Set(),onlineWinRefreshTried=new Set();$$,$$const onlineWinRecorded=new Set(),onlineWinPending=new Set(),onlineWinRefreshPending=new Set(),onlineWinRefreshTried=new Set();
const onlineLossRecorded=new Set(),onlineLossPending=new Set();$$),$$events:[],winProof:snapshotWinProof,matchId:snapshotMatchId$$,$$events:[],winProof:snapshotWinProof,lossProof:snapshotLossProof,matchId:snapshotMatchId$$),$$if(typeof patch.winProof==="string"&&patch.winProof)snapshotWinProof=patch.winProof;
 if(typeof patch.matchId==="string"&&patch.matchId)snapshotMatchId=patch.matchId;$$,$$if(typeof patch.winProof==="string"&&patch.winProof)snapshotWinProof=patch.winProof;
 if(typeof patch.lossProof==="string"&&patch.lossProof)snapshotLossProof=patch.lossProof;
 if(typeof patch.matchId==="string"&&patch.matchId)snapshotMatchId=patch.matchId;$$),$$removeId:patch.removeId||null,winProof:snapshotWinProof,matchId:snapshotMatchId$$,$$removeId:patch.removeId||null,winProof:snapshotWinProof,lossProof:snapshotLossProof,matchId:snapshotMatchId$$),$$function queuePatch(patch){
 patchChain=patchChain.catch(()=>{}).then(async()=>{
  const snap=await mergeUnonPatch(patch);
  await maybeRecordOnlineWin(snap);
  return snap;
 });$$,$$async function maybeRecordOnlineLoss(snap){
 const pub=snap&&snap.public,result=pub&&pub.result;
 if(!pub||pub.phase!=="finished"||!result||result.reason!=="win"||result.winnerId===UID)return;
 const matchId=String(snap.matchId||snapshotMatchId||pub.matchId||""),roomId=String(room&&room.id||"");
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(matchId)||!roomId||
    onlineLossRecorded.has(matchId)||onlineLossPending.has(matchId))return;
 const lossProof=typeof snap.lossProof==="string"&&snap.lossProof?snap.lossProof:snapshotLossProof;
 if(!lossProof)return;
 onlineLossPending.add(matchId);
 try{
  const kg=await ensureSDK();
  let saved=false,lastError=null;
  for(let attempt=0;attempt<2&&!saved;attempt++){
   try{
    await kg.stats.recordResult({
     mode:"wins-online",
     result:"loss",
     submissionId:matchId,
     metadata:{source:"unon-online",matchId,roomId,lossProof}
    });
    saved=true;
   }catch(error){
    lastError=error;
    if(attempt===0)await new Promise(resolve=>setTimeout(resolve,600));
   }
  }
  if(!saved)throw lastError||new Error("敗北数を登録できませんでした。");
  onlineLossRecorded.add(matchId);
  rankCache=null;
  console.info("UNONオンライン敗北数を記録しました:",matchId);
 }catch(error){
  console.warn("UNONオンライン敗北数の記録に失敗しました。",error);
 }finally{
  onlineLossPending.delete(matchId);
 }
}
function queuePatch(patch){
 patchChain=patchChain.catch(()=>{}).then(async()=>{
  const snap=await mergeUnonPatch(patch);
  await maybeRecordOnlineWin(snap);
  await maybeRecordOnlineLoss(snap);
  return snap;
 });$$)
where id='faa155cb-2143-4361-9a96-dc759d334e46';

-- Daifugo CPU losses use the restricted aggregate-only result endpoint.
update public.game_studio_games
set html_content=replace(replace(html_content,$$  async function loadDaifugoRanking(rankingMode){$$,$$async function submitDaifugoLoss(){
    const status=$('rankSubmitStatus');
    if(status) status.textContent='CPU対戦の敗北数を記録しています...';
    try{
      if(!window.KuroGames || !window.KuroGames.stats || typeof window.KuroGames.stats.recordResult!=='function'){
        throw new Error('結果記録SDKを読み込めませんでした。');
      }
      const config=await window.KuroGames.init({gameId:'2eb37847-1b7e-43e4-ad98-901d5b830ac4'});
      if(!config.features || config.features.ranking!==true) throw new Error('ランキング機能が無効になっています。');
      await window.KuroGames.stats.recordResult({
        mode:'wins-bot',
        result:'loss',
        submissionId:rankingRoundId,
        metadata:{source:'daifugo-bot',opponentMode:'bot'}
      });
      if(status) status.textContent='CPU対戦の敗北数を記録しました。';
    }catch(error){
      if(status) status.textContent='敗北数を記録できませんでした。通信状態を確認してください。';
      console.warn('大富豪CPU敗北記録:',error);
    }
  }

  async function loadDaifugoRanking(rankingMode){$$),$$    if(playerWon && !rankingSubmittedThisGame){
      rankingSubmittedThisGame=true;
      if(daifugoOnlineGameActive){
        $('rankSubmitStatus').textContent='オンライン勝利数は対局サーバーで記録しました。';
      }else{
        submitDaifugoWin('wins-bot');
      }
    }$$,$$    if(!rankingSubmittedThisGame){
      rankingSubmittedThisGame=true;
      if(daifugoOnlineGameActive){
        $('rankSubmitStatus').textContent='オンラインの勝敗数は対局サーバーで記録しました。';
      }else if(playerWon){
        submitDaifugoWin('wins-bot');
      }else{
        submitDaifugoLoss();
      }
    }$$)
where id='2eb37847-1b7e-43e4-ad98-901d5b830ac4';
