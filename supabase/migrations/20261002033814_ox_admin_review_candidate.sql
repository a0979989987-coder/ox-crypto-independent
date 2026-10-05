-- CANDIDATE ONLY. Not applied to production. Requires existing Account/UID schema.
begin;
do $$begin
 if current_user in ('anon','authenticated') then raise exception 'UNTRUSTED_MIGRATION_ROLE';end if;
 if not exists(select 1 from pg_roles where rolname='ox_review_executor') then
  create role ox_review_executor nologin noinherit nobypassrls;
  -- CREATEROLE grants creator ADMIN, but PG16+ does not grant creator SET.
  -- Only the trusted creator gets SET; no privilege inheritance or app membership.
  if current_setting('server_version_num')::int>=160000 then
   execute format('grant ox_review_executor to %I with set true',current_user);
   execute format('grant ox_review_executor to %I with inherit false',current_user);
  else execute format('grant ox_review_executor to %I',current_user);end if;
 elsif exists(select 1 from pg_roles where rolname='ox_review_executor' and (rolcanlogin or rolbypassrls or rolsuper or rolinherit or rolcreaterole or rolcreatedb or rolreplication)) then raise exception 'UNSAFE_EXISTING_REVIEW_EXECUTOR';end if;
 if pg_has_role('anon','ox_review_executor','MEMBER') or pg_has_role('authenticated','ox_review_executor','MEMBER') then raise exception 'UNSAFE_EXISTING_REVIEW_EXECUTOR_MEMBERSHIP';end if;
 if current_setting('server_version_num')::int>=160000 then
  if not pg_has_role(current_user,'ox_review_executor','SET') then raise exception 'MIGRATION_EXECUTOR_SET_REQUIRED';end if;
 elsif not pg_has_role(current_user,'ox_review_executor','MEMBER') then raise exception 'MIGRATION_EXECUTOR_MEMBERSHIP_REQUIRED';end if;
end;$$;
create schema ox_review_live;
revoke all on schema ox_review_live from public,anon,authenticated;
grant usage on schema ox_review_live,public,auth to ox_review_executor;
grant execute on function auth.uid() to ox_review_executor;
create table ox_review_live.administrators(account_id uuid primary key references public.ox_accounts(id) on delete cascade,active boolean not null default false);
create table ox_review_live.policy(
  singleton boolean primary key default true check(singleton),version uuid not null default gen_random_uuid(),
  ordinary_configured boolean not null default false,
  ordinary_capabilities text[] not null default '{}',capability_catalog text[] not null default '{all_member_features}',
  exclusive_uid boolean not null default true,
  check(ordinary_capabilities <@ capability_catalog),
  check(not ('admin'=any(capability_catalog)))
);
-- Empty admin list; ordinary permissions unconfigured. No member bootstrap.
insert into ox_review_live.policy(singleton) values(true);
create table ox_review_live.approvals(
  id uuid primary key default gen_random_uuid(),account_id uuid not null references public.ox_accounts(id) on delete cascade,
  uid text not null check(uid ~ '^[1-9][0-9]{0,19}$'),claim_revision uuid not null,version uuid not null default gen_random_uuid(),
  level text not null check(level in ('ordinary','core')),capabilities text[] not null,policy_version uuid not null,
  exclusive_uid boolean not null default true,source text not null default 'manual_approval' check(source='manual_approval'),
  ownership_verified boolean not null default false check(not ownership_verified),
  status text not null default 'active' check(status in ('active','revoked','invalidated')),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index ox_review_live_one_member on ox_review_live.approvals(account_id) where status='active';
create unique index ox_review_live_one_uid on ox_review_live.approvals(uid) where status='active' and exclusive_uid;
create table ox_review_live.audit(
  sequence bigint generated always as identity primary key,actor_id uuid,actor_kind text not null check(actor_kind in ('admin','member','system')),
  action text not null check(action in ('approve','revoke','invalidate')),approval_id uuid not null,
  reason text not null,detail jsonb not null,created_at timestamptz not null default now()
);
create table ox_review_live.batches(actor_id uuid not null,idempotency_key uuid not null,fingerprint text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,idempotency_key));
revoke all on all tables in schema ox_review_live from public,anon,authenticated,ox_review_executor;
revoke all on all sequences in schema ox_review_live from public,anon,authenticated,ox_review_executor;
alter table ox_review_live.administrators enable row level security;
alter table ox_review_live.policy enable row level security;
alter table ox_review_live.approvals enable row level security;
alter table ox_review_live.audit enable row level security;
alter table ox_review_live.batches enable row level security;
grant select on ox_review_live.administrators,ox_review_live.policy to ox_review_executor;
grant select,insert,update on ox_review_live.approvals to ox_review_executor;
grant select,insert on ox_review_live.audit,ox_review_live.batches to ox_review_executor;
grant usage on all sequences in schema ox_review_live to ox_review_executor;
create policy ox_review_executor_admin_read on ox_review_live.administrators for select to ox_review_executor using(true);
create policy ox_review_executor_policy_read on ox_review_live.policy for select to ox_review_executor using(true);
create policy ox_review_executor_approval_read on ox_review_live.approvals for select to ox_review_executor using(true);
create policy ox_review_executor_approval_insert on ox_review_live.approvals for insert to ox_review_executor with check(true);
create policy ox_review_executor_approval_update on ox_review_live.approvals for update to ox_review_executor using(true) with check(true);
create policy ox_review_executor_audit_read on ox_review_live.audit for select to ox_review_executor using(true);
create policy ox_review_executor_audit_insert on ox_review_live.audit for insert to ox_review_executor with check(true);
create policy ox_review_executor_batch_read on ox_review_live.batches for select to ox_review_executor using(true);
create policy ox_review_executor_batch_insert on ox_review_live.batches for insert to ox_review_executor with check(true);
grant select on public.ox_accounts,public.ox_bitget_links to ox_review_executor;
create policy ox_review_executor_account_read on public.ox_accounts for select to ox_review_executor using(true);
create policy ox_review_executor_claim_read on public.ox_bitget_links for select to ox_review_executor using(true);

create function ox_review_live.require_admin() returns uuid language plpgsql set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if actor is null then raise insufficient_privilege using message='SIGN_IN_REQUIRED';end if;
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('ox-review-admin:'||actor::text,0));
  if not exists(select 1 from ox_review_live.administrators where account_id=actor and active) then raise insufficient_privilege using message='ADMIN_REQUIRED';end if;
  return actor;
end;$$;
create function ox_review_live.protect_config() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if TG_TABLE_NAME='administrators' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ox-review-admin:'||coalesce(OLD.account_id,NEW.account_id)::text,0));
  else
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ox-review-policy',0));
    if TG_OP='UPDATE' then NEW.version:=gen_random_uuid();end if;
  end if;
  if TG_OP='DELETE' then return OLD;else return NEW;end if;
end;$$;
create trigger ox_review_admin_change before update or delete on ox_review_live.administrators for each row execute function ox_review_live.protect_config();
create trigger ox_review_policy_change before update or delete on ox_review_live.policy for each row execute function ox_review_live.protect_config();
create function ox_review_live.audit_immutable() returns trigger language plpgsql set search_path='' as $$begin raise insufficient_privilege using message='AUDIT_APPEND_ONLY';end;$$;
create trigger ox_review_audit_immutable before update or delete on ox_review_live.audit for each row execute function ox_review_live.audit_immutable();
create function ox_review_live.claim_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); changed ox_review_live.approvals%rowtype; member uuid;
begin
  member:=OLD.account_id;
  if TG_OP='UPDATE' and NEW.uid is not distinct from OLD.uid and NEW.revision is not distinct from OLD.revision then return NEW;end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(member::text,0));
  for changed in update ox_review_live.approvals set status='invalidated',version=gen_random_uuid(),updated_at=now() where account_id=member and status='active' returning * loop
    insert into ox_review_live.audit(actor_id,actor_kind,action,approval_id,reason,detail) values(actor,case when actor is null then 'system' else 'member' end,'invalidate',changed.id,'UID claim changed',to_jsonb(changed));
  end loop;
  if TG_OP='DELETE' then return OLD;else return NEW;end if;
end;$$;
create trigger ox_review_claim_changed after update or delete on public.ox_bitget_links for each row execute function ox_review_live.claim_changed();

create function public.ox_admin_review_rpc(p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 actor uuid; policy ox_review_live.policy%rowtype; item jsonb; claims jsonb; result jsonb; results jsonb:='[]'::jsonb;
 previous ox_review_live.batches%rowtype; existing ox_review_live.approvals%rowtype; approved ox_review_live.approvals%rowtype;
 claim public.ox_bitget_links%rowtype; member uuid; revision uuid; request_key uuid; payload_hash text; reason text; target_uid text; level text; caps text[]; n integer;
begin
 if auth.uid() is null then raise insufficient_privilege using message='SIGN_IN_REQUIRED';end if;
 if p_action is null or p_action not in ('effective','status','lookup','records','approve','revoke') then return jsonb_build_object('ok',false,'code','INVALID_ACTION');end if;
 if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>65536 then return jsonb_build_object('ok',false,'code','INVALID_PAYLOAD');end if;
 if p_action='effective' then
   if p_payload<>'{}'::jsonb then return jsonb_build_object('ok',false,'code','INVALID_PAYLOAD');end if;
   select * into policy from ox_review_live.policy where singleton;
   select a.* into approved from ox_review_live.approvals a join public.ox_bitget_links l on l.account_id=a.account_id
    where a.account_id=auth.uid() and a.status='active' and a.uid=l.uid and a.claim_revision=l.revision and a.policy_version=policy.version;
   return jsonb_build_object('ok',true,'approval',case when approved.id is null then null else jsonb_build_object('level',approved.level,'capabilities',approved.capabilities,'source',approved.source) end,'ownershipVerified',false,'adminRightsIncluded',false);
 end if;
 actor:=ox_review_live.require_admin();
 perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('ox-review-policy',0));
 select * into policy from ox_review_live.policy where singleton;
 if policy.version is null then return jsonb_build_object('ok',false,'code','REVIEW_POLICY_UNAVAILABLE');end if;
 if p_action='status' then
   if p_payload<>'{}'::jsonb then return jsonb_build_object('ok',false,'code','INVALID_PAYLOAD');end if;
   return jsonb_build_object('ok',true,'administrator',true,'policyVersion',policy.version,'ordinaryConfigured',policy.ordinary_configured,'exclusiveUid',policy.exclusive_uid);
 elsif p_action='lookup' then
   if exists(select 1 from jsonb_object_keys(p_payload) k where k<>'uids') or jsonb_typeof(p_payload->'uids') is distinct from 'array' then return jsonb_build_object('ok',false,'code','INVALID_UIDS');end if;
   n:=jsonb_array_length(p_payload->'uids');
   if n<1 or n>100 or exists(select 1 from jsonb_array_elements(p_payload->'uids') v where jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^[1-9][0-9]{0,19}$') then return jsonb_build_object('ok',false,'code','INVALID_UIDS');end if;
   select coalesce(jsonb_agg(jsonb_build_object('accountId',l.account_id,'uid',l.uid,'revision',l.revision,'name','OX 會員') order by l.account_id),'[]'::jsonb) into claims
    from (select bounded.account_id,bounded.uid,bounded.revision from public.ox_bitget_links bounded where bounded.uid in(select value from jsonb_array_elements_text(p_payload->'uids')) order by bounded.account_id limit 1001) l;
   if jsonb_array_length(claims)>1000 then return jsonb_build_object('ok',false,'code','TOO_MANY_MATCHES');end if;
   return jsonb_build_object('ok',true,'claims',claims,'policyVersion',policy.version,'ordinaryConfigured',policy.ordinary_configured,'ordinaryCapabilities',policy.ordinary_capabilities,'coreCapabilities',array['all_member_features'],'exclusiveUid',policy.exclusive_uid,'adminRightsIncluded',false);
 elsif p_action='records' then
   if p_payload<>'{}'::jsonb then return jsonb_build_object('ok',false,'code','INVALID_PAYLOAD');end if;
   select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id),'[]'::jsonb) into claims from(
    select a.*,(a.status='active' and a.policy_version=policy.version and exists(select 1 from public.ox_bitget_links l where l.account_id=a.account_id and l.uid=a.uid and l.revision=a.claim_revision)) as effective
    from ox_review_live.approvals a order by created_at desc,id limit 100)a;
   select coalesce(jsonb_agg(to_jsonb(a) order by a.sequence),'[]'::jsonb) into results from(select * from ox_review_live.audit order by sequence desc limit 200)a;
   return jsonb_build_object('ok',true,'approvals',claims,'audit',results,'truncated',((select count(*)>100 from ox_review_live.approvals) or (select count(*)>200 from ox_review_live.audit)));
 elsif p_action not in ('approve','revoke') then return jsonb_build_object('ok',false,'code','INVALID_ACTION');end if;

 -- Low-volume administration uses a DB-wide mutation lock, not a process-local
 -- queue. Fixed member lock ordering shares the existing pending-link protocol.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ox-review-mutations',0));
 if jsonb_typeof(p_payload->'idempotencyKey') is distinct from 'string' or (p_payload->>'idempotencyKey') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return jsonb_build_object('ok',false,'code','IDEMPOTENCY_KEY_REQUIRED');end if;
 request_key:=(p_payload->>'idempotencyKey')::uuid;
 if jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(btrim(p_payload->>'reason'))<1 or length(p_payload->>'reason')>500 then return jsonb_build_object('ok',false,'code','REASON_REQUIRED');end if;
 reason:=btrim(p_payload->>'reason');
 payload_hash:=encode(sha256(convert_to(jsonb_build_object('action',p_action,'payload',p_payload)::text,'UTF8')),'hex');
 select * into previous from ox_review_live.batches where actor_id=actor and idempotency_key=request_key;
 if previous.idempotency_key is not null then
   if previous.fingerprint<>payload_hash then return jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');end if;
   return previous.result;
 end if;
 if p_action='approve' then
   if exists(select 1 from jsonb_object_keys(p_payload) k where k not in('idempotencyKey','policyVersion','reason','entries')) or jsonb_typeof(p_payload->'entries') is distinct from 'array' then return jsonb_build_object('ok',false,'code','INVALID_BATCH');end if;
   if jsonb_typeof(p_payload->'policyVersion') is distinct from 'string' or p_payload->>'policyVersion'<>policy.version::text then return jsonb_build_object('ok',false,'code','POLICY_CHANGED');end if;
   n:=jsonb_array_length(p_payload->'entries');if n<1 or n>100 then return jsonb_build_object('ok',false,'code','INVALID_BATCH');end if;
   for item in select value from jsonb_array_elements(p_payload->'entries') loop
     if jsonb_typeof(item) is distinct from 'object' then return jsonb_build_object('ok',false,'code','INVALID_ENTRY');end if;
     if exists(select 1 from jsonb_object_keys(item) k where k not in('uid','accountId','revision','level')) or
       jsonb_typeof(item->'uid') is distinct from 'string' or item->>'uid' !~ '^[1-9][0-9]{0,19}$' or
       jsonb_typeof(item->'accountId') is distinct from 'string' or item->>'accountId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or
       jsonb_typeof(item->'revision') is distinct from 'string' or item->>'revision' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or
       jsonb_typeof(item->'level') is distinct from 'string' or item->>'level' not in('ordinary','core') then return jsonb_build_object('ok',false,'code','INVALID_ENTRY');end if;
   end loop;
   if exists(select 1 from jsonb_array_elements(p_payload->'entries') e group by e->>'uid' having count(*)>1) or
      exists(select 1 from jsonb_array_elements(p_payload->'entries') e group by (e->>'accountId')::uuid having count(*)>1) then return jsonb_build_object('ok',false,'code','DUPLICATE_TARGET');end if;
   for member in select distinct (e->>'accountId')::uuid from jsonb_array_elements(p_payload->'entries') e order by 1 loop
     perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(member::text,0));
   end loop;
   for item in select value from jsonb_array_elements(p_payload->'entries') loop
     member:=(item->>'accountId')::uuid;target_uid:=item->>'uid';revision:=(item->>'revision')::uuid;level:=item->>'level';
     select * into claim from public.ox_bitget_links where account_id=member;
     if claim.account_id is null or claim.uid is distinct from target_uid or claim.revision is distinct from revision then
       results:=results||jsonb_build_array(jsonb_build_object('uid',target_uid,'accountId',member,'code','CLAIM_CHANGED'));continue;
     end if;
     -- Policy changes immediately stop effective reads; reconcile under the
     -- mutation lock before testing exclusivity. Every change is audited.
     for existing in update ox_review_live.approvals set status='invalidated',version=gen_random_uuid(),updated_at=now() where status='active' and policy_version<>policy.version returning * loop
       insert into ox_review_live.audit(actor_id,actor_kind,action,approval_id,reason,detail) values(actor,'admin','invalidate',existing.id,'Policy changed',to_jsonb(existing));
     end loop;
     if exists(select 1 from ox_review_live.approvals a where a.status='active' and (a.account_id=member or (policy.exclusive_uid and a.uid=target_uid))) then
       results:=results||jsonb_build_array(jsonb_build_object('uid',target_uid,'accountId',member,'code','ACTIVE_APPROVAL_EXISTS'));continue;
     end if;
     caps:=case when level='core' then array['all_member_features'] else policy.ordinary_capabilities end;
     if level='ordinary' and not policy.ordinary_configured then results:=results||jsonb_build_array(jsonb_build_object('uid',target_uid,'accountId',member,'code','ORDINARY_POLICY_UNCONFIGURED'));continue;end if;
     if not(caps <@ policy.capability_catalog) then results:=results||jsonb_build_array(jsonb_build_object('uid',target_uid,'accountId',member,'code','CAPABILITY_UNAVAILABLE'));continue;end if;
     insert into ox_review_live.approvals(account_id,uid,claim_revision,level,capabilities,policy_version,exclusive_uid) values(member,target_uid,revision,level,caps,policy.version,policy.exclusive_uid) returning * into approved;
     insert into ox_review_live.audit(actor_id,actor_kind,action,approval_id,reason,detail) values(actor,'admin','approve',approved.id,reason,to_jsonb(approved));
     results:=results||jsonb_build_array(jsonb_build_object('uid',target_uid,'accountId',member,'code','APPROVED','approval',to_jsonb(approved)));
   end loop;
   result:=jsonb_build_object('ok',true,'results',results,'approvalSource','manual_approval','ownershipVerified',false,'adminRightsIncluded',false);
 else
   if exists(select 1 from jsonb_object_keys(p_payload) k where k not in('idempotencyKey','reason','approvalId','version')) or
     jsonb_typeof(p_payload->'approvalId') is distinct from 'string' or p_payload->>'approvalId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or
     jsonb_typeof(p_payload->'version') is distinct from 'string' or p_payload->>'version' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return jsonb_build_object('ok',false,'code','INVALID_REVOKE');end if;
   select * into existing from ox_review_live.approvals where id=(p_payload->>'approvalId')::uuid;
   if existing.id is null then return jsonb_build_object('ok',false,'code','APPROVAL_NOT_FOUND');end if;
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(existing.account_id::text,0));
   select * into existing from ox_review_live.approvals where id=existing.id;
   if existing.version<>(p_payload->>'version')::uuid then return jsonb_build_object('ok',false,'code','APPROVAL_CHANGED');end if;
   if existing.status<>'active' then result:=jsonb_build_object('ok',true,'code','ALREADY_INACTIVE');
   else
     update ox_review_live.approvals set status='revoked',version=gen_random_uuid(),updated_at=now() where id=existing.id returning * into approved;
     insert into ox_review_live.audit(actor_id,actor_kind,action,approval_id,reason,detail) values(actor,'admin','revoke',approved.id,reason,to_jsonb(approved));
     result:=jsonb_build_object('ok',true,'code','REVOKED','approval',to_jsonb(approved));
   end if;
 end if;
 insert into ox_review_live.batches(actor_id,idempotency_key,fingerprint,result) values(actor,request_key,payload_hash,result);
 return result;
end;$$;
-- Helpers/triggers and the public RPC execute as a restricted non-owner role.
grant create on schema public,ox_review_live to ox_review_executor;
alter function ox_review_live.require_admin() owner to ox_review_executor;
alter function ox_review_live.protect_config() owner to ox_review_executor;
alter function ox_review_live.audit_immutable() owner to ox_review_executor;
alter function ox_review_live.claim_changed() owner to ox_review_executor;
alter function public.ox_admin_review_rpc(text,jsonb) owner to ox_review_executor;
revoke create on schema public,ox_review_live from ox_review_executor;
set local role ox_review_executor;
revoke all on all functions in schema ox_review_live from public,anon,authenticated;
revoke all on function public.ox_admin_review_rpc(text,jsonb) from public,anon,authenticated;
grant execute on function public.ox_admin_review_rpc(text,jsonb) to authenticated;
reset role;
commit;
