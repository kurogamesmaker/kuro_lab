-- Keep invitation validity separate from the Pro access period granted on acceptance.
alter table public.pro_invitations
  add column if not exists membership_expires_at timestamptz;
