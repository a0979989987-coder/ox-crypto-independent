-- REVIEW ONLY. Not executed against the existing production project.
-- A pending claim is NOT account ownership or entitlement verification.
begin;
create table public.ox_bitget_links (
  account_id uuid primary key default auth.uid() references public.ox_accounts(id) on delete cascade,
  uid text check (uid ~ '^[1-9][0-9]{0,19}$'),
  ownership_status text not null default 'pending' check (ownership_status = 'pending'),
  revision uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Deliberately no global UNIQUE(uid): unverified input cannot reserve someone's UID.
-- A future proved-ownership record MUST enforce unique UID before granting ownership.
alter table public.ox_bitget_links enable row level security;
revoke all on public.ox_bitget_links from public, anon, authenticated;
grant select on public.ox_bitget_links to authenticated;
create policy ox_bitget_link_self_read on public.ox_bitget_links for select to authenticated using ((select auth.uid()) = account_id);

create function public.ox_set_pending_bitget_link(p_action text, p_uid text, p_revision uuid) returns jsonb
-- Definer must be the trusted migration/table owner. No caller-supplied member ID,
-- dynamic SQL or direct member DML grants; every mutation is scoped by auth.uid().
language plpgsql security definer set search_path = '' as $$
declare
  member_id uuid := auth.uid();
  current_link public.ox_bitget_links%rowtype;
  next_link public.ox_bitget_links%rowtype;
begin
  if member_id is null then raise insufficient_privilege; end if;
  if p_action not in ('save', 'remove') or p_action is null then raise invalid_parameter_value; end if;
  if p_action = 'save' and (p_uid is null or p_uid !~ '^[1-9][0-9]{0,19}$') then raise invalid_parameter_value; end if;
  if p_action = 'remove' and p_uid is not null then raise invalid_parameter_value; end if;
  -- Serialize writes for this member only, including two simultaneous first claims.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(member_id::text, 0));
  select * into current_link from public.ox_bitget_links where account_id = member_id for update;
  if current_link.revision is distinct from p_revision then
    return pg_catalog.jsonb_build_object('code', 'REVISION_CONFLICT');
  end if;
  if p_action = 'remove' then
    if current_link.account_id is null then
      return pg_catalog.jsonb_build_object('code', 'OK', 'link', null);
    elsif current_link.uid is null then
      next_link := current_link;
    else
      -- Remove the UID but retain a fresh revision (no old UID/history), so a
      -- stale first-time page cannot overwrite a link after its removal.
      update public.ox_bitget_links set uid = null, revision = gen_random_uuid(), updated_at = now()
        where account_id = member_id returning * into next_link;
    end if;
  elsif current_link.account_id is null then
    insert into public.ox_bitget_links(uid) values (p_uid) returning * into next_link;
  elsif current_link.uid = p_uid then
    next_link := current_link;
  else
    update public.ox_bitget_links set uid = p_uid, revision = gen_random_uuid(), updated_at = now()
      where account_id = member_id returning * into next_link;
  end if;
  return pg_catalog.jsonb_build_object('code', 'OK', 'link', pg_catalog.jsonb_build_object('uid', next_link.uid, 'revision', next_link.revision, 'ownership_status', 'pending'));
end;
$$;
revoke all on function public.ox_set_pending_bitget_link(text, text, uuid) from public, anon;
grant execute on function public.ox_set_pending_bitget_link(text, text, uuid) to authenticated;
commit;
