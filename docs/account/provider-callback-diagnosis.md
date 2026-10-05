# Live provider callback failure

The user's video after PR48 visibly reports `provider_callback_error`. This is evidence that the OX callback received a provider `error` parameter. That branch runs before pending flow-cookie validation, PKCE exchange, session saving, or member-table reads. It does not establish the underlying Supabase/Google cause.

This update carries only allowlisted public error codes (or `unclassified`) to the UI. Raw descriptions, user identifiers, callback codes, tokens, cookies, and full callback URLs are never logged or reflected. The code is an unauthenticated diagnostic label, not an authorization assertion. Unknown values and arrays fall back to fixed labels. Transient labels are removed from the browser URL and return paths.

Other reviewed paths: session cookies contain separate encrypted access/refresh token strings, not provider tokens or the full provider session/user object. Each value is bounded to 3800 characters. Session authentication depends on Supabase `getUser`, not member-row existence; failed/missing RLS reads leave an authenticated user with an explicit storage status. No cookie limits, PKCE checks, auth settings, schema, or credentials are changed.

Validation: 226/226 tests and build pass against main `535c73f`; isolated UI tests cover the allowlisted provider code and refusal to reflect arbitrary details. SDK fixtures are synthetic and do not prove live login succeeds.

Next evidence required: after release, report only the displayed fixed provider code, once. If it is `unexpected_failure`/`server_error`, use the existing project's Auth logs, then corresponding Postgres logs if they indicate a database error. Return only status, public error code and SQLSTATE/category; do not share complete records or URLs. A database-trigger defect remains a hypothesis until those logs establish it.

Official references:
- https://supabase.com/docs/guides/auth/debugging/error-codes
- https://supabase.com/docs/guides/troubleshooting/database-error-saving-new-user-RU_EwB
- https://supabase.com/dashboard/project/zczdxepbrczuyoobafep/logs/auth-logs
- https://supabase.com/dashboard/project/zczdxepbrczuyoobafep/logs/postgres-logs
