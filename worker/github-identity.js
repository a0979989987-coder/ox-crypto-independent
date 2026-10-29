// Short-lived GitHub Actions identity for the data publisher; no stored credential or Site secret.
import { PUBLISH_AUDIENCE, REPOSITORY, REPOSITORY_ID, REPOSITORY_OWNER_ID, DATA_WORKFLOWS } from './site.js';
const ISSUER = 'https://token.actions.githubusercontent.com';
const WORKFLOWS = new Set(DATA_WORKFLOWS.map(file => REPOSITORY + '/.github/workflows/' + file + '@refs/heads/main'));
let keys, expires = 0;
const decode = part => Uint8Array.from(atob(part.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
const json = part => JSON.parse(new TextDecoder().decode(decode(part)));
export async function verifyPublisher(request, { fetcher = fetch, now = Date.now() } = {}) {
  try {
    const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_.-]{1,20000})$/)?.[1];
    if (!token) throw Error();
    const parts = token.split('.'); if (parts.length !== 3) throw Error();
    const header = json(parts[0]), claims = json(parts[1]), seconds = now / 1000;
    if (header.alg !== 'RS256' || header.typ !== 'JWT' || typeof header.kid !== 'string' || header.kid.length > 200) throw Error();
    if (claims.iss !== ISSUER || claims.aud !== PUBLISH_AUDIENCE || claims.repository !== REPOSITORY || claims.repository_id !== REPOSITORY_ID || claims.repository_owner_id !== REPOSITORY_OWNER_ID ||
      claims.ref !== 'refs/heads/main' || claims.ref_type !== 'branch' || !WORKFLOWS.has(claims.workflow_ref) ||
      !['push', 'schedule', 'workflow_dispatch'].includes(claims.event_name) || typeof claims.sub !== 'string' || !claims.sub ||
      !Number.isFinite(claims.exp) || claims.exp <= seconds || claims.exp > seconds + 900 || !Number.isFinite(claims.nbf) || claims.nbf > seconds + 30 ||
      !Number.isFinite(claims.iat) || claims.iat > seconds + 30 || seconds - claims.iat > 900) throw Error();
    if (!keys || now >= expires || !keys.some(key => key.kid === header.kid)) {
      const response = await fetcher(ISSUER + '/.well-known/jwks', { signal: AbortSignal.timeout(6000) }); if (!response.ok) throw Error();
      keys = (await response.json()).keys; if (!Array.isArray(keys) || keys.length > 20) throw Error(); expires = now + 300000;
    }
    const jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA' && key.use === 'sig'); if (!jwk) throw Error();
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), new TextEncoder().encode(parts.slice(0, 2).join('.')))) throw Error();
    return claims;
  } catch { return null; }
}
