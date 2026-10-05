-- REVIEW ONLY. Non-destructive rollback after an approved successful migration.
-- Roll back the UID UI/API release first. Keep all pending data for recovery.
begin;
revoke execute on function public.ox_set_pending_bitget_link(text, text, uuid) from authenticated;
revoke select on public.ox_bitget_links from authenticated;
commit;
-- To re-enable after review: grant select on public.ox_bitget_links to authenticated;
-- grant execute on function public.ox_set_pending_bitget_link(text,text,uuid) to authenticated;
