-- Emergency disable only: retain pending claims, approvals and immutable audit.
begin;
update ox_review_live.administrators set active=false where active;
set local role ox_review_executor;
revoke execute on function public.ox_admin_review_rpc(text,jsonb) from authenticated;
reset role;
commit;
-- Application rollback: revert admin release only; preserve latest market main.
