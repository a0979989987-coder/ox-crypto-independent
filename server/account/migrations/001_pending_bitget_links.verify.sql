-- READ ONLY metadata checks. No UID, member data, token or credential output.
-- Preflight (before migration): new objects must be absent; member table must exist.
select to_regclass('public.ox_accounts') as existing_member_table,
       to_regclass('public.ox_bitget_links') as new_table,
       to_regprocedure('public.ox_set_pending_bitget_link(text,text,uuid)') as new_rpc;

-- Run the following only after an approved successful migration.
select c.relrowsecurity as rls_enabled,
       pg_get_userbyid(c.relowner) as trusted_table_owner,
       p.prosecdef as security_definer,
       pg_get_userbyid(p.proowner) as trusted_function_owner,
       p.proconfig as fixed_search_path
from pg_class c join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.proname = 'ox_set_pending_bitget_link' and p.pronamespace = n.oid
where n.nspname = 'public' and c.relname = 'ox_bitget_links';

select has_table_privilege('anon', 'public.ox_bitget_links', 'SELECT') as anon_select_must_be_false,
       has_table_privilege('authenticated', 'public.ox_bitget_links', 'SELECT') as member_select_must_be_true,
       has_any_column_privilege('authenticated', 'public.ox_bitget_links', 'INSERT') as direct_insert_must_be_false,
       has_any_column_privilege('authenticated', 'public.ox_bitget_links', 'UPDATE') as direct_update_must_be_false,
       has_table_privilege('authenticated', 'public.ox_bitget_links', 'DELETE') as direct_delete_must_be_false,
       has_function_privilege('anon', 'public.ox_set_pending_bitget_link(text,text,uuid)', 'EXECUTE') as anon_execute_must_be_false,
       has_function_privilege('authenticated', 'public.ox_set_pending_bitget_link(text,text,uuid)', 'EXECUTE') as member_execute_must_be_true;

select cmd, roles, qual, with_check from pg_policies
where schemaname = 'public' and tablename = 'ox_bitget_links';
-- Expected: one SELECT policy to authenticated, auth.uid() = account_id.
