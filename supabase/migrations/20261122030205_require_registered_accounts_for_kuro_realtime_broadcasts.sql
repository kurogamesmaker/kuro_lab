alter policy "KURO room members can receive private room broadcasts"
on realtime.messages
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and exists (
    select 1
    from public.game_online_room_members m
    join public.game_online_rooms r on r.id = m.room_id
    where m.user_id = (select auth.uid())
      and r.id::text = split_part(realtime.topic(), ':', 3)
      and r.game_id::text = split_part(realtime.topic(), ':', 2)
      and r.status <> 'closed'
      and r.expires_at > now()
  )
);

alter policy "KURO room members can send private room broadcasts"
on realtime.messages
with check (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and exists (
    select 1
    from public.game_online_room_members m
    join public.game_online_rooms r on r.id = m.room_id
    where m.user_id = (select auth.uid())
      and r.id::text = split_part(realtime.topic(), ':', 3)
      and r.game_id::text = split_part(realtime.topic(), ':', 2)
      and r.status <> 'closed'
      and r.expires_at > now()
  )
);
