-- Keep group conversations available to remaining members when their creator deletes their KURO account.
alter table public.group_conversations
  alter column created_by drop not null;

alter table public.group_conversations
  drop constraint if exists group_conversations_created_by_fkey;

alter table public.group_conversations
  add constraint group_conversations_created_by_fkey
  foreign key (created_by)
  references auth.users(id)
  on delete set null;
