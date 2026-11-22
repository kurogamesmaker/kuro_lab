-- Require a real KURO account for direct access to built-in online room tables.
-- Anonymous Supabase Auth users also have the authenticated role, so check the JWT claim explicitly.
alter policy "KURO users can read their own room membership"
on public.game_online_room_members
using (
  user_id = (select auth.uid())
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
);

alter policy "KURO members can read their rooms"
on public.game_online_rooms
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and exists (
    select 1 from public.game_online_room_members m
    where m.room_id = game_online_rooms.id
      and m.user_id = (select auth.uid())
  )
);

alter policy werewolf_room_host_create
on public.werewolf_rooms
with check (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and host_uid = (select auth.uid())
  and (room_data ->> 'hostUid') = ((select auth.uid()))::text
  and exists (
    select 1
    from jsonb_array_elements(coalesce(room_data -> 'players', '[]'::jsonb)) p(value)
    where p.value ->> 'uid' = ((select auth.uid()))::text
  )
);

alter policy werewolf_room_host_delete
on public.werewolf_rooms
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and host_uid = (select auth.uid())
);

alter policy werewolf_room_member_read
on public.werewolf_rooms
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (
    status = 'lobby'
    or host_uid = (select auth.uid())
    or exists (
      select 1
      from jsonb_array_elements(coalesce(room_data -> 'players', '[]'::jsonb)) p(value)
      where p.value ->> 'uid' = ((select auth.uid()))::text
    )
  )
);

alter policy werewolf_room_member_update
on public.werewolf_rooms
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (
    status = 'lobby'
    or host_uid = (select auth.uid())
    or exists (
      select 1
      from jsonb_array_elements(coalesce(room_data -> 'players', '[]'::jsonb)) p(value)
      where p.value ->> 'uid' = ((select auth.uid()))::text
    )
  )
)
with check (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
);

alter policy werewolf_chat_member_insert
on public.werewolf_chat_messages
with check (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and user_id = (select auth.uid())
  and char_length(trim(message)) between 1 and 500
  and exists (
    select 1
    from public.werewolf_rooms r,
      lateral jsonb_array_elements(coalesce(r.room_data -> 'players', '[]'::jsonb)) p(value)
    where r.room_code = werewolf_chat_messages.room_code
      and r.status in ('lobby','playing')
      and p.value ->> 'uid' = ((select auth.uid()))::text
      and p.value ->> 'name' = werewolf_chat_messages.player_name
  )
);

alter policy werewolf_chat_member_read
on public.werewolf_chat_messages
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and exists (
    select 1
    from public.werewolf_rooms r,
      lateral jsonb_array_elements(coalesce(r.room_data -> 'players', '[]'::jsonb)) p(value)
    where r.room_code = werewolf_chat_messages.room_code
      and p.value ->> 'uid' = ((select auth.uid()))::text
  )
);
