-- Existing project only. Additive compatibility repair; no auth schema/table grants.
-- Requires existing restricted executor and trusted schema owner with SET permission.
begin;
do $$begin
 if current_user in ('anon','authenticated') or not exists(select 1 from pg_roles
   where rolname='ox_review_executor' and not rolcanlogin and not rolinherit
   and not rolsuper and not rolbypassrls and not rolcreaterole and not rolcreatedb
   and not rolreplication) then raise exception 'UNSAFE_REVIEW_REPAIR_ROLE';end if;
 if pg_has_role('anon','ox_review_executor','MEMBER') or pg_has_role('authenticated','ox_review_executor','MEMBER')
 then raise exception 'UNSAFE_REVIEW_EXECUTOR_MEMBERSHIP';end if;
 if has_schema_privilege('ox_review_executor','public','CREATE') or has_schema_privilege('ox_review_executor','ox_review_live','CREATE')
 then raise exception 'UNEXPECTED_EXECUTOR_SCHEMA_CREATE';end if;
end;$$;
create or replace function ox_review_live.claim_uid() returns uuid
language sql stable security invoker set search_path='' as $$
 select coalesce(nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),''),
   (nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid
$$;
create or replace function ox_review_live.claim_jwt() returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(nullif(pg_catalog.current_setting('request.jwt.claim',true),''),
   nullif(pg_catalog.current_setting('request.jwt.claims',true),''))::jsonb
$$;
revoke all on function ox_review_live.claim_uid(),ox_review_live.claim_jwt() from public,anon,authenticated,ox_review_executor;
grant execute on function ox_review_live.claim_uid(),ox_review_live.claim_jwt() to ox_review_executor;
-- Temporary, transaction-scoped ability to replace these existing owned functions.
grant create on schema public,ox_review_live to ox_review_executor;
set local role ox_review_executor;
do $$declare f regprocedure; definition text;begin
 foreach f in array array[
   'ox_review_live.require_admin()'::regprocedure,
   'ox_review_live.claim_changed()'::regprocedure,
   'public.ox_admin_review_rpc(text,jsonb)'::regprocedure,
   'public.ox_feature_access_rpc(text,jsonb)'::regprocedure
 ] loop
   if not exists(select 1 from pg_proc where oid=f and proowner=current_user::regrole)
   then raise exception 'UNEXPECTED_REVIEW_FUNCTION_OWNER';end if;
   definition:=pg_catalog.pg_get_functiondef(f);
   definition:=pg_catalog.replace(pg_catalog.replace(definition,'auth.uid()','ox_review_live.claim_uid()'),'auth.jwt()','ox_review_live.claim_jwt()');
   if definition like '%auth.%' then raise exception 'UNEXPECTED_AUTH_REFERENCE';end if;
   execute definition;
 end loop;
end;$$;
reset role;
revoke create on schema public,ox_review_live from ox_review_executor;
commit;
