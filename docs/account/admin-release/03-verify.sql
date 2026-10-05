select singleton,ordinary_configured,ordinary_capabilities,capability_catalog,exclusive_uid from ox_review_live.policy;
select count(*) filter(where active) active_admins from ox_review_live.administrators;
select count(*) approvals from ox_review_live.approvals;
select count(*) audit_rows from ox_review_live.audit;
select rolsuper,rolcanlogin,rolinherit,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls from pg_roles where rolname='ox_review_executor';
select has_function_privilege('anon','public.ox_admin_review_rpc(text,jsonb)','EXECUTE') anon_rpc,has_function_privilege('authenticated','public.ox_admin_review_rpc(text,jsonb)','EXECUTE') member_rpc;
select has_table_privilege('ox_review_executor','ox_review_live.audit','UPDATE,DELETE,TRUNCATE') mutable_audit;
