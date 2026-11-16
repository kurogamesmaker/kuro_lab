alter table public.pro_applications
  add column if not exists requested_plan text not null default 'pro';

alter table public.pro_memberships
  add column if not exists plan text not null default 'pro';

alter table public.pro_invitations
  add column if not exists plan text not null default 'pro';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pro_applications_requested_plan_check') then
    alter table public.pro_applications
      add constraint pro_applications_requested_plan_check
      check (requested_plan in ('standard', 'pro'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pro_memberships_plan_check') then
    alter table public.pro_memberships
      add constraint pro_memberships_plan_check
      check (plan in ('standard', 'pro'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pro_invitations_plan_check') then
    alter table public.pro_invitations
      add constraint pro_invitations_plan_check
      check (plan in ('standard', 'pro'));
  end if;
end $$;

create index if not exists pro_applications_plan_status_created_idx
  on public.pro_applications(requested_plan, status, created_at desc);
create index if not exists pro_memberships_plan_status_idx
  on public.pro_memberships(plan, status);
