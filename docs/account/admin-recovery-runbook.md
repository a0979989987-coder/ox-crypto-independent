# OX admin release recovery

## Current acceptance: 2026-10-05 03:26 UTC

Latest main bdada6f0ac6df0812035c54b9fc7dd1a7fa2391e is integrated locally. Removed US market remains removed; main index/styles/market modules are unchanged except two Account script cache-version strings. Latest white/champagne theme, gray navigation, macro calendar and mobile changes remain intact. Full original Admin candidate b88fe1c is retained in history; isolated Email branch codex/email-login-recovery has no Admin API/schema/UI dependency.

Local final QA: integrated Admin 458/458 full tests; isolated Email 427/427; native PostgreSQL 17/17; build 96 assets/171 IDs. Account, mobile Email cooldown/fragment, local Admin and production-router/SDK/RLS synthetic UI passed. Tests cover UID owner isolation/revision CAS, duplicate/conflict selections, explicit member/ordinary/core confirmation, immutable audit, revoke/rebind/policy invalidation, ordinary zero rights, core member marker without admin, metadata forgery, stale session/verification responses and provider error redaction. Synthetic provider tests are not real Email delivery or current real Google acceptance.

Read-only production DB: active_admins=0, ordinary_configured=false, ordinary_capabilities=[], capability_catalog=[all_member_features], exclusive_uid=true, anon_rpc=false, member_rpc=true, mutable_audit=false. Migration exists; bootstrap remains absent. No migration or bootstrap writes were attempted. Public site anonymous smoke: root/assets/config/session HTTP200, configured=true, anonymous session null; admin-review HTTP404; deployed Account source still has old Google cancellation text and no Email cooldown/fragment fix. GitHub Vercel status for main bdada6f is success at https://vercel.com/ox-lab/ox-crypto-screener/DUZUpt4K6H8SG88k2LNFpWK2rWqF . This confirms that deployment, not remaining quota/reset availability. No release was triggered.

### Parent handoff / remaining release checks

1. Confirm authorization and choose isolated Email release first or full Account/Admin candidate. No push, merge or deploy occurs in this round. After release verify the exact deployed SHA and both Account assets; cache versions are bumped to 20261005-email1.
2. Admin bootstrap is independent of Email. Restore supported Supabase connector request state before one bootstrap through that route. Use existing private Library libfile_2b498d195140819183f4fc1e2b15240d version 2, OX-Admin-production-SQL-v3.zip. Public docs/account/admin-release/02-bootstrap.sql is only a placeholder. Do not rerun successful migration or execute emergency disable as part of bootstrap.
3. The bootstrap operator needs SELECT on auth.users/auth.identities/public.ox_accounts, INSERT/UPDATE on ox_review_live.administrators and UPDATE on ox_review_live.policy (trusted existing table owner/operator). Do not grant these rights to anon/authenticated, add keys, broaden executor membership or make service-role available to clients. Transaction must match exactly one confirmed Google identity and existing OX account; reject another active admin. It only initializes intended admin/policy and never approves real UIDs.
4. Parent should read docs/account/admin-release/03-verify.sql after bootstrap: exactly one intended active admin, ordinary_configured=true, empty ordinary capabilities, exclusive_uid=true, member catalog only all_member_features; anon RPC false, member RPC true, immutable audit and restricted executor flags. No new real approvals/audit records are expected.
5. User must initiate one fresh Email request after release, use its unused link in the initiating browser, confirm stored account center, refresh then log out. Keep Google real historical success separate from a fresh production retest. Do not reopen old otp_expired links; 60-second client cooldown does not promise hourly-provider quota reset. For public launch, verify actual Email/SMTP readiness and limits read-only; no SMTP/security settings are changed here.
6. After bootstrap/release verify real admin status and read-only admin page, and guest/nonadmin rejection. Do not use real members to test approvals or expose identity/UID records publicly. Public market access stays open; manual approval remains manual/unverified, never an official BG ownership/KYC result.

Earlier history follows; old deployment quota observations are not current reset guarantees.


2026-10-02: production v3 migration succeeded per parent; bootstrap remains blocked by connector `Invalid or expired requestState`. Parent read-only check at 09:08 UTC: active admins 0, ordinary_configured false. Do not infer bootstrap success or retry writes through another tool.

## Preserved release

PR #80 stays draft, remote tested head e47aa09. Local branch codex/admin-review-release additionally integrates main 16a9b4a (PR82–85 ETF fallback, quote/classification dates, mobile rail and rightmost radar preserved). Local follow-up is not pushed while quota is blocked, because pushes can trigger Vercel preview deployments.

Public bootstrap contains only REPLACE_WITH_VERIFIED_GOOGLE_EMAIL. Real-account bootstrap stays in private Library OX-Admin-production-SQL-v3.zip, library ID libfile_2b498d195140819183f4fc1e2b15240d, version 2. It verifies one confirmed auth.users email, the same verified Google identity email, an existing OX account, and no other active admin. No UID approvals are created. Never paste real account details into public PRs or logs.

## Deployment evidence

Vercel was READY at 2026-10-02 09:19:17 UTC for 0d015454bd1582a54a6e343d13be3b1b2c7b9650, but parent subsequently observed another daily-cap failure at 09:49:26 UTC. A prior successful deployment does not establish current available quota. Functions storage was reported at 9.84/10 GB. Exact quota reset/remaining is unknown; coordinate one consolidated release only after a fresh read-only availability check. Do not push or redeploy automatically.

Evidence URLs:
- https://api.github.com/repos/a0979989987-coder/ox-crypto-screener/commits/a3e47ff77e4e8cb974e8e653462c6cc1ec0bd59f/statuses
- https://vercel.com/docs/limits

## Resume only after the blockers are resolved

1. Parent reads current private admin/policy status before any write. If bootstrap is still absent, restore the original connector request state/authorization, then execute the private transactional bootstrap once through that supported route. This agent does not attempt a different tool or duplicate writes.
2. Verify exactly one intended active admin, ordinary_configured true with empty ordinary capabilities, exclusive_uid true, core catalog all_member_features; no new real approvals/audit rows. Verify anonymous RPC false, authenticated RPC true, restricted executor attributes and immutable audit privileges. Do not rerun the successful migration.
3. Read the quota reset/remaining state without starting a deployment. When deployment is available and DB-ready is confirmed, fetch latest main, integrate/retest locally, push one consolidated candidate update, review PR, then merge/release once. Retain latest ETF/news/market features.
4. Confirm the production deployment SHA and READY state, then validate real Google admin session and the account-center admin entry. Open /previews/account-admin/ and read status/records only; guest/member must be rejected and synthetic session buttons must be hidden. Do not approve example UIDs or the owner's saved UID automatically. Email real delivery remains untested until an explicitly initiated email flow is completed.

## Routes and rights

Static admin page switches outside localhost to /api/v1/account/admin-review. Actual api/v1/account/[endpoint].js dispatches to Account handler; provider getUser validates HttpOnly-cookie token, the SDK passes that same member JWT to ox_admin_review_rpc, and the DB rechecks private admin membership. Production transport UI test exercises this actual router/handler/SDK/SQL with synthetic provider data, not a production OAuth success claim.

Account center shows admin entry only after admin status succeeds; epoch guards discard stale role responses. Ordinary approval is recorded with zero added capabilities. Core records all_member_features without admin rights or financial transaction permissions. Current public markets remain public; no gates were added.

## Emergency disable

Use docs/account/admin-release/04-disable.sql only if separately needed: deactivate admins as trusted table owner, SET LOCAL ROLE executor and revoke authenticated RPC, retain claims/approvals/audit. Keep current public market access unchanged. Re-enable only with reviewed owner ACL and intended admin verification.

## Completed local QA

After integrating main 16a9b4a: 510/510 full tests, 17/17 native PostgreSQL tests, build 96 assets/171 unique IDs, Account UI (including admin visibility and stale-admin logout response), synthetic local admin UI, mobile Email cooldown/error UI, and production transport router/handler/SDK/SQL UI all passed. Independent security review passed. These follow-up commits are local only; remote PR #80 remains draft at e47aa09. Google real success is retained from prior validation; Email real login and post-bootstrap production admin acceptance remain untested.

## Email recovery follow-up (local only)

Real evidence: logout returned 204 at 09:33:36 and 09:34:51 UTC. OTP send returned 200 at 09:34:15, followed by 429 on repeated sends; verify/token events occurred before logout. At 09:45:22/29 verify reported One-time token not found and redirected with access_denied/otp_expired. This establishes an invalid email link, not whether it was consumed or expired; switching devices is not a confirmed cause. Real Email login acceptance still requires a newly initiated, unused link and user confirmation after release. Existing Google real success is retained.

Local fixes map direct error fragments as well as callback errors to fixed generic categories, remove raw error URLs, preserve PKCE, open the account center only after a verified callback/session, coalesce repeated email submissions, retain a timestamp-only 60-second same-tab cooldown across reload, and expose HTTP 429 clearly. The cooldown is a click guard, not a promise that provider hourly quota has reset. No automatic resend, real email, credential/template change, user-cookie operation or deployment occurs in these tests. Late session/verification UI responses cannot restore a logged-out user; this synthetic race is not claimed as the real logout cause.

Email changes are isolated in commit 4d2a97d; integrated main merge is 57c71b7. Public remote PR remains unchanged, and no release is triggered. Final independent review accepted the verification/session epoch guard and found no new security blocker.
