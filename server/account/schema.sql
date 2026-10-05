-- Run once in the OX Supabase project's SQL Editor. No market feature gates.
begin;
create table if not exists public.ox_accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.ox_accounts enable row level security;
revoke all on public.ox_accounts from anon, authenticated;
grant select on public.ox_accounts to authenticated;
create policy ox_accounts_self_read on public.ox_accounts for select to authenticated using ((select auth.uid()) = id);
create table if not exists public.ox_service_entitlements (
  account_id uuid not null references public.ox_accounts(id) on delete cascade,
  service text not null,
  capability text not null,
  enabled boolean not null default false,
  verified_at timestamptz,
  primary key (account_id, service, capability)
);
alter table public.ox_service_entitlements enable row level security;
revoke all on public.ox_service_entitlements from anon, authenticated;
grant select on public.ox_service_entitlements to authenticated;
create policy ox_entitlements_self_read on public.ox_service_entitlements for select to authenticated using ((select auth.uid()) = account_id);
create or replace function public.ox_create_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ox_accounts(id) values(new.id) on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.ox_create_account() from public, anon, authenticated;
create trigger ox_account_created after insert on auth.users for each row execute function public.ox_create_account();
insert into public.ox_accounts(id) select id from auth.users on conflict do nothing;
commit;
