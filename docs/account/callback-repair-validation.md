# Account callback repair validation

Base: `c2c4d2f`, branch `codex/account-callback-repair`. These changes have not been published.

Confirmed defects: callback failures were collapsed into one error flag while the UI attributed all failures to expiration or another browser. Retrying from that URL retained the error flag in the return location. The repair uses fixed non-sensitive failure categories, removes transient auth parameters from return locations, and suppresses stale errors when a verified user already exists. PKCE, encrypted cookies, Secure/HttpOnly/SameSite=Lax, origin checks, and member RLS remain enforced. Callback failure clears the pending flow without signing out an existing session.

The SDK flow identifier is carried inside the encrypted flow cookie and passed to code exchange; an untrusted URL identifier is ignored. Legacy flow cookies remain supported.

Validation: `npm test` passes 216/216; `node scripts/check-build.mjs` passes 92 local assets and 169 IDs. `node scripts/account-ui-check.mjs` passes callback reason display, cleaned retry URL, authenticated stale-error suppression, Magic Link registration, provider failure recovery, member profile escaping/storage display, mobile width and logout. `node scripts/e2e-check.cjs` passes desktop/mobile and runtime audits. `node scripts/account-cookie-check.mjs` uses an isolated synthetic browser to confirm the encrypted flow cookie survives cross-site top-level navigation; it does not model the live provider's HTTP redirect chain.

Six added SDK tests use the actual installed Supabase SDK with synthetic provider responses: matching PKCE exchange and encrypted session storage, expired exchange categorization, successful retry cleanup, signed flow ID, invalid/missing flow rejection, and provider refusal sanitization. They are not evidence of a successful live Google/Email login or real membership persistence.

The user's first live failure remains undetermined. After an approved release, retry on the production site and report only the fixed reason label if it fails. Do not collect auth codes, cookies, tokens, provider error descriptions, or secrets. No new credentials, schema changes, or Bitget changes are required by this repair.
