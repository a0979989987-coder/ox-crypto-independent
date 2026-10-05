-- LOCAL DRAFT ONLY. Requires deployed Account + ox_review_live Admin migration.
-- Existing trusted migration owner; never run as anon/authenticated.
begin;
do $$begin
 if current_user in ('anon','authenticated') or not exists(select 1 from pg_roles where rolname='ox_review_executor' and not rolcanlogin and not rolinherit and not rolsuper and not rolbypassrls and not rolcreaterole and not rolcreatedb and not rolreplication) then raise exception 'UNSAFE_FEATURE_MIGRATION_ROLE';end if;
 if pg_has_role('anon','ox_review_executor','MEMBER') or pg_has_role('authenticated','ox_review_executor','MEMBER') then raise exception 'UNSAFE_FEATURE_EXECUTOR_MEMBERSHIP';end if;
end;$$;
create table ox_review_live.features(
 id text primary key check(id in ('crypto.home','crypto.radar','crypto.patterns','crypto.bubbles','crypto.strength','crypto.heatmap','crypto.rotation','crypto.flow','tw.home','tw.radar','tw.patterns','tw.bubbles','tw.rotation','tw.etf','tw.savings','news.feed','news.calendar','media')),
 mode text not null default 'public' check(mode in ('public','login')),
 version uuid not null default gen_random_uuid(),changed_at timestamptz not null default now()
);
insert into ox_review_live.features(id) select unnest(array['crypto.home','crypto.radar','crypto.patterns','crypto.bubbles','crypto.strength','crypto.heatmap','crypto.rotation','crypto.flow','tw.home','tw.radar','tw.patterns','tw.bubbles','tw.rotation','tw.etf','tw.savings','news.feed','news.calendar','media']);
create table ox_review_live.feature_audit(
 sequence bigint generated always as identity primary key,actor_id uuid not null,feature text not null,
 old_mode text not null,new_mode text not null,reason text not null check(length(reason) between 1 and 300),created_at timestamptz not null default now()
);
create table ox_review_live.feature_requests(actor_id uuid not null,idempotency_key uuid not null,fingerprint text not null,result jsonb not null,primary key(actor_id,idempotency_key));
revoke all on ox_review_live.features,ox_review_live.feature_audit,ox_review_live.feature_requests from public,anon,authenticated,ox_review_executor;
alter table ox_review_live.features enable row level security;
alter table ox_review_live.feature_audit enable row level security;
alter table ox_review_live.feature_requests enable row level security;
grant select,update on ox_review_live.features to ox_review_executor;
grant select,insert on ox_review_live.feature_audit,ox_review_live.feature_requests to ox_review_executor;
revoke all on sequence ox_review_live.feature_audit_sequence_seq from public,anon,authenticated,ox_review_executor;
grant usage on sequence ox_review_live.feature_audit_sequence_seq to ox_review_executor;
create policy feature_executor_read on ox_review_live.features for select to ox_review_executor using(true);
create policy feature_executor_update on ox_review_live.features for update to ox_review_executor using(true) with check(true);
create policy feature_audit_read on ox_review_live.feature_audit for select to ox_review_executor using(true);
create policy feature_audit_insert on ox_review_live.feature_audit for insert to ox_review_executor with check(true);
create policy feature_requests_read on ox_review_live.feature_requests for select to ox_review_executor using(true);
create policy feature_requests_insert on ox_review_live.feature_requests for insert to ox_review_executor with check(true);
create function ox_review_live.feature_audit_immutable() returns trigger language plpgsql set search_path='' as $$begin raise insufficient_privilege using message='AUDIT_APPEND_ONLY';end;$$;
revoke all on function ox_review_live.feature_audit_immutable() from public,anon,authenticated;
create trigger feature_audit_immutable before update or delete or truncate on ox_review_live.feature_audit for each statement execute function ox_review_live.feature_audit_immutable();
create function public.ox_feature_access_rpc(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; target ox_review_live.features%rowtype; prior ox_review_live.feature_requests%rowtype;
 result jsonb; request_id uuid; fingerprint text; reason text;
begin
 if p_action='catalog' and p_payload='{}'::jsonb then
  return jsonb_build_object('ok',true,'features',(select jsonb_agg(jsonb_build_object('id',id,'mode',mode,'version',version) order by id) from ox_review_live.features));
 end if;
 if p_action='access' then
  if jsonb_typeof(p_payload) is distinct from 'object' or p_payload-'feature'<>'{}'::jsonb or jsonb_typeof(p_payload->'feature') is distinct from 'string' then return jsonb_build_object('ok',false,'code','INVALID_FEATURE_REQUEST');end if;
  select * into target from ox_review_live.features where id=p_payload->>'feature';
  if not found then return jsonb_build_object('ok',false,'code','INVALID_FEATURE_REQUEST');end if;
  return jsonb_build_object('ok',true,'allowed',target.mode='public' or (auth.uid() is not null and coalesce(auth.jwt()->>'is_anonymous','false')<>'true' and exists(select 1 from public.ox_accounts where id=auth.uid())),'feature',target.id,'mode',target.mode,'version',target.version);
 end if;
 actor:=ox_review_live.require_admin();
 if p_action='records' and p_payload='{}'::jsonb then
  return jsonb_build_object('ok',true,'features',(select jsonb_agg(jsonb_build_object('id',id,'mode',mode,'version',version) order by id) from ox_review_live.features),'audit',coalesce((select jsonb_agg(a order by a.sequence desc) from (select * from ox_review_live.feature_audit order by sequence desc limit 100) a),'[]'::jsonb));
 end if;
 if p_action<>'update' or p_action is null or jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['feature','mode','version','reason','idempotencyKey']<>'{}'::jsonb or jsonb_typeof(p_payload->'feature') is distinct from 'string' or jsonb_typeof(p_payload->'mode') is distinct from 'string' or coalesce(p_payload->>'mode','') not in ('public','login') or jsonb_typeof(p_payload->'reason') is distinct from 'string' then return jsonb_build_object('ok',false,'code','INVALID_FEATURE_REQUEST');end if;
 reason:=btrim(p_payload->>'reason');
 if length(reason) not between 1 and 300 or coalesce(p_payload->>'version','')!~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or coalesce(p_payload->>'idempotencyKey','')!~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return jsonb_build_object('ok',false,'code','INVALID_FEATURE_REQUEST');end if;
 request_id:=(p_payload->>'idempotencyKey')::uuid;fingerprint:=md5(p_payload::text);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ox-feature-request:'||actor::text||':'||request_id::text,0));
 select * into prior from ox_review_live.feature_requests where actor_id=actor and idempotency_key=request_id;
 if found then
  if prior.fingerprint<>fingerprint then return jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');end if;
  return prior.result;
 end if;
 select * into target from ox_review_live.features where id=p_payload->>'feature' for update;
 if not found then return jsonb_build_object('ok',false,'code','INVALID_FEATURE_REQUEST');end if;
 if target.version<>(p_payload->>'version')::uuid then return jsonb_build_object('ok',false,'code','VERSION_CONFLICT');end if;
 if target.mode<>p_payload->>'mode' then
  update ox_review_live.features set mode=p_payload->>'mode',version=gen_random_uuid(),changed_at=now() where id=target.id;
  insert into ox_review_live.feature_audit(actor_id,feature,old_mode,new_mode,reason) values(actor,target.id,target.mode,p_payload->>'mode',reason);
 end if;
 select jsonb_build_object('ok',true,'feature',id,'mode',mode,'version',version) into result from ox_review_live.features where id=target.id;
 insert into ox_review_live.feature_requests values(actor,request_id,fingerprint,result);
 return result;
end;$$;
grant create on schema public to ox_review_executor;
alter function public.ox_feature_access_rpc(text,jsonb) owner to ox_review_executor;
revoke create on schema public from ox_review_executor;
set local role ox_review_executor;
revoke all on function public.ox_feature_access_rpc(text,jsonb) from public,anon,authenticated;
-- anon may read product policy only. Every admin action independently checks DB.
grant execute on function public.ox_feature_access_rpc(text,jsonb) to anon,authenticated;
reset role;
commit;
