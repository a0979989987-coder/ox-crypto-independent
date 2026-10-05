begin;
do $$declare target uuid; n integer;begin
 select count(*),min(u.id::text)::uuid into n,target from auth.users u where lower(u.email)='REPLACE_WITH_VERIFIED_GOOGLE_EMAIL' and u.email_confirmed_at is not null and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google' and lower(i.identity_data->>'email')='REPLACE_WITH_VERIFIED_GOOGLE_EMAIL' and i.identity_data->>'email_verified'='true');
 if n<>1 or not exists(select 1 from public.ox_accounts where id=target) then raise exception 'EXPECTED_ONE_EXISTING_GOOGLE_OX_ACCOUNT';end if;
 if exists(select 1 from ox_review_live.administrators where active and account_id<>target) then raise exception 'UNEXPECTED_EXISTING_ADMIN';end if;
 insert into ox_review_live.administrators(account_id,active) values(target,true) on conflict(account_id) do update set active=true;
 update ox_review_live.policy set ordinary_configured=true,ordinary_capabilities='{}',capability_catalog='{all_member_features}',exclusive_uid=true;
end;$$;
commit;
