/**
 * OneMap token management — runs ONLY on the server (Vercel function or the
 * local dev bridge). The browser never sees ONEMAP_EMAIL, ONEMAP_PASSWORD,
 * or even the access token itself.
 *
 * OneMap tokens are valid for 3 days. We cache the token in module scope
 * (survives across requests while the serverless instance stays warm) and
 * refresh it 6 hours before expiry. A cold start simply fetches a fresh one.
 */

const ONEMAP_BASE = 'https://www.onemap.gov.sg';
const REFRESH_BUFFER_MS = 6 * 60 * 60 * 1000; // refresh 6h before expiry

let cached = { token: null, expiresAt: 0 };

export async function getOneMapToken(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cached.token && now < cached.expiresAt - REFRESH_BUFFER_MS) {
    return cached.token;
  }

  const email = process.env.ONEMAP_EMAIL;
  const password = process.env.ONEMAP_PASSWORD;
  if (!email || !password) {
    const err = new Error(
      'OneMap credentials are not configured. Add ONEMAP_EMAIL and ONEMAP_PASSWORD ' +
        'in Vercel → Project → Settings → Environment Variables (or in .env for local dev).'
    );
    err.code = 'NO_CREDS';
    throw err;
  }

  const res = await fetch(`${ONEMAP_BASE}/api/auth/post/getToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(
      `OneMap login failed (HTTP ${res.status}). Check that ONEMAP_EMAIL / ONEMAP_PASSWORD ` +
        'match your OneMap account at https://www.onemap.gov.sg/apidocs/register'
    );
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('OneMap login response did not include an access token.');
  }

  // expiry_timestamp is unix seconds, ~3 days ahead. Fall back to +3 days.
  const expiresAt =
    Number(data.expiry_timestamp) * 1000 || now + 3 * 24 * 60 * 60 * 1000;
  cached = { token: data.access_token, expiresAt };
  return cached.token;
}

/**
 * Fetch an authenticated OneMap URL, tolerating either Authorization header
 * style ("<token>" per the docs, "Bearer <token>" used by some deployments)
 * and force-refreshing the token once if it has been invalidated.
 */
export async function oneMapFetch(url, { forceRefresh = false } = {}) {
  let token = await getOneMapToken(forceRefresh);

  const attempt = (auth) =>
    fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(8000) });

  let res = await attempt(token);
  if (res.status === 401) res = await attempt(`Bearer ${token}`);
  if (res.status === 401) {
    token = await getOneMapToken(true); // token may have been revoked — refresh
    res = await attempt(token);
  }
  return res;
}
