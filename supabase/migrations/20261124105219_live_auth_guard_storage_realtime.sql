-- Reject still-unexpired JWTs belonging to deleted users from Storage and Realtime.
-- The helper returns true only while auth.users still contains auth.uid().

create policy kuro_require_live_auth_user
on storage.objects
as restrictive
for all
to authenticated
using ((select public.kuro_auth_user_exists()))
with check ((select public.kuro_auth_user_exists()));

create policy kuro_require_live_auth_user
on realtime.messages
as restrictive
for all
to authenticated
using ((select public.kuro_auth_user_exists()))
with check ((select public.kuro_auth_user_exists()));
