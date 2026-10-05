select current_user,rolsuper,rolcreaterole from pg_roles where rolname=current_user;
select to_regclass('public.ox_accounts') accounts,to_regclass('public.ox_bitget_links') pending,to_regnamespace('ox_review_live') existing_candidate;
select rolname,rolsuper,rolcanlogin,rolinherit,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls from pg_roles where rolname='ox_review_executor';
-- If executor exists, explicitly verify current migration role SET/ADMIN membership before apply. Never grant executor to anon/authenticated.
