OX Admin production candidate. Apply only to zczdxepbrczuyoobafep, existing Account + pending UID schema.
Order: read 00-preflight.sql; trusted migration role must own existing tables and have CREATEROLE and SET/ADMIN access to ox_review_executor. If role absent, provision restricted NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION executor, grant explicit ADMIN/SET membership only to the trusted migration role, never anon/authenticated. Do not change service credentials.
Apply 01-migration.sql then 02-bootstrap.sql, run 03-verify.sql. Expected active admins=1, configured ordinary empty rights, exclusive UID true, capability all_member_features, new approvals/audit zero, anon RPC false/authenticated true/mutable audit false. No real UID approval is created.
04-disable.sql is separately invoked emergency disable, never concatenate into application.
Core all_member_features is a member grant marker for future controls; current public feature behavior unchanged; never includes admin or financial transaction permissions.

V3 role handover: when executor is absent, CREATEROLE creator receives explicit SET TRUE and INHERIT FALSE on PG16+, without additional ADMIN grant. Existing executor requires existing SET authorization and fails closed otherwise. No app-role membership is granted. PG15 lacks per-membership SET/INHERIT options; use ordinary creator membership only, or require PG16+ deployment policy. Check server_version_num before apply.

PUBLIC TEMPLATE ONLY: 02-bootstrap.sql contains a placeholder and cannot identify a real admin. The private owner bootstrap is delivered separately through Library, never in GitHub history. No real UID/account UUID is present in this release.
