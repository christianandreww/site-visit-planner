import crypto from 'node:crypto';

/**
 * Check a Firebase sign-in token on the server, so an endpoint knows for
 * certain which rep is asking — without the Firebase Admin SDK and without a
 * service-account key. Firebase signs these tokens with Google keys that are
 * published openly; checking the signature and the claims below is what the
 * Admin SDK's verifyIdToken() does too.
 */

const CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

// Clocks drift a little between Google, Vercel and phones.
const SKEW_SECONDS = 60;

let keyCache = { keys: null, expiresAt: 0 };

/** Google's current signing keys, cached for as long as Google says they're good. */
async function googleKeys() {
  if (keyCache.keys && Date.now() < keyCache.expiresAt) return keyCache.keys;
  const res = await fetch(CERTS_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Could not fetch Google's sign-in keys (HTTP ${res.status}).`);
  const pems = await res.json();
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1]) || 3600;
  const keys = {};
  for (const [kid, pem] of Object.entries(pems)) {
    keys[kid] = new crypto.X509Certificate(pem).publicKey;
  }
  keyCache = { keys, expiresAt: Date.now() + maxAge * 1000 };
  return keys;
}

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

class AuthError extends Error {}

/**
 * Returns { uid, email, emailVerified } for a valid token, or throws.
 * `getKeys` and `now` exist so tests can use their own keys and clock.
 */
export async function verifyFirebaseToken(token, { projectId, getKeys = googleKeys, now = Date.now() } = {}) {
  if (!projectId) throw new AuthError('Server is missing the Firebase project ID.');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new AuthError('Malformed sign-in token.');
  const [h, p, s] = parts;

  let header;
  let payload;
  try {
    header = decode(h);
    payload = decode(p);
  } catch {
    throw new AuthError('Malformed sign-in token.');
  }
  if (header.alg !== 'RS256') throw new AuthError('Unexpected token algorithm.');

  const keys = await getKeys();
  const key = keys[header.kid];
  if (!key) throw new AuthError('Token signed with an unknown key.');
  const signed = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'));
  if (!signed) throw new AuthError('Token signature does not match.');

  const t = Math.floor(now / 1000);
  if (payload.aud !== projectId) throw new AuthError('Token is for a different app.');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new AuthError('Token has the wrong issuer.');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) {
    throw new AuthError('Token has no user.');
  }
  if (!(Number(payload.exp) > t - SKEW_SECONDS)) throw new AuthError('Sign-in has expired.');
  if (!(Number(payload.iat) <= t + SKEW_SECONDS)) throw new AuthError('Token is not valid yet.');
  if (payload.auth_time !== undefined && !(Number(payload.auth_time) <= t + SKEW_SECONDS)) {
    throw new AuthError('Token is not valid yet.');
  }

  return {
    uid: payload.sub,
    email: payload.email ? String(payload.email).toLowerCase() : '',
    emailVerified: payload.email_verified === true,
  };
}

export { AuthError };
