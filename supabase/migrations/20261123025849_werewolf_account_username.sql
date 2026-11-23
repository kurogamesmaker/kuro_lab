create or replace function public.werewolf_join_room(p_room_code text, p_player_name text)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_kuro_id text;
  v_username text;
  v_data jsonb;
  v_players jsonb;
  v_existing boolean;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_room_code !~ '^[A-Z0-9]{6}$' and p_room_code !~ '^[0-9]{4}$' then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  -- 表示名はクライアント入力ではなく、ログイン中のKUROプロフィールから取得する。
  select kuro_id, username
    into v_kuro_id, v_username
  from public.profiles
  where id = v_uid;

  v_username := left(trim(coalesce(v_username, '')), 24);
  if v_username = '' then raise exception 'ACCOUNT_NAME_REQUIRED'; end if;

  select room_data into v_data
  from public.werewolf_rooms
  where room_code = p_room_code
  for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;

  v_players := coalesce(v_data->'players', '[]'::jsonb);
  select exists(
    select 1 from jsonb_array_elements(v_players) p
    where p->>'uid' = v_uid::text
  ) into v_existing;

  if not v_existing and v_data->>'status' <> 'lobby' then
    raise exception 'GAME_ALREADY_STARTED';
  end if;

  if v_existing then
    select jsonb_agg(
      case when p->>'uid' = v_uid::text then
        jsonb_set(
          jsonb_set(
            jsonb_set(p, '{name}', to_jsonb(v_username), true),
            '{kuroId}', coalesce(to_jsonb(v_kuro_id), 'null'::jsonb), true
          ),
          '{uid}', to_jsonb(v_uid::text), true
        )
      else p end
      order by ord
    ) into v_players
    from jsonb_array_elements(v_players) with ordinality as x(p, ord);
  else
    if jsonb_array_length(v_players) >= 35 then raise exception 'ROOM_FULL'; end if;
    v_players := v_players || jsonb_build_array(jsonb_build_object(
      'uid', v_uid::text,
      'kuroId', v_kuro_id,
      'name', v_username,
      'role', null,
      'isAlive', true
    ));
  end if;

  v_data := jsonb_set(v_data, '{players}', v_players, true);
  update public.werewolf_rooms
  set room_data = v_data, updated_at = now()
  where room_code = p_room_code;
  return v_data;
end;
$function$;