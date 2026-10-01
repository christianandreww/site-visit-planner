import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyFirebaseToken } from '../api/_lib/firebaseAuth.js';

// A stand-in for Google's signing keys: tests sign their own tokens with a
// key pair made here, and hand the verifier the matching public key.
const PROJECT = 'site-visit-planner-test';
const google = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const attacker = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const getKeys = async () => ({ 'kid-1': google.publicKey });

const NOW = Date.UTC(2026, 9, 1, 4, 0, 0); // 1 Oct 2026, 12pm SGT
const t = Math.floor(NOW / 1000);

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function token(claims = {}, { kid = 'kid-1', key = google.privateKey, alg = 'RS256' } = {}) {
  const header = b64({ alg, kid, typ: 'JWT' });
  const payload = b64({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: 'uid-jason',
    email: 'Jason@GetSolar.example',
    email_verified: true,
    iat: t - 300,
    exp: t + 3300,
    auth_time: t - 300,
    ...claims,
  });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key).toString('base64url');
  return `${header}.${payload}.${sig}`;
}

const verify = (tok, opts = {}) => verifyFirebaseToken(tok, { projectId: PROJECT, getKeys, now: NOW, ...opts });

test('a genuine sign-in token says who is asking', async () => {
  const who = await verify(token());
  assert.deepEqual(who, { uid: 'uid-jason', email: 'jason@getsolar.example', emailVerified: true });
});

test('tokens for another app, issuer or time are refused', async () => {
  await assert.rejects(verify(token({ aud: 'someone-elses-app' })), /different app/);
  await assert.rejects(verify(token({ iss: 'https://evil.example' })), /wrong issuer/);
  await assert.rejects(verify(token({ exp: t - 3600 })), /expired/);
  await assert.rejects(verify(token({ iat: t + 3600 })), /not valid yet/);
  await assert.rejects(verify(token({ sub: '' })), /no user/);
});

test('a forged or altered token is refused', async () => {
  // Signed with a key Google never published, but claiming Google's key id.
  await assert.rejects(verify(token({}, { key: attacker.privateKey })), /signature/);

  // Someone swaps the email in a real token for a colleague's.
  const [h, , s] = token().split('.');
  const swapped = b64({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: 'uid-jason',
    email: 'boss@getsolar.example',
    email_verified: true,
    iat: t - 300,
    exp: t + 3300,
  });
  await assert.rejects(verify(`${h}.${swapped}.${s}`), /signature/);

  await assert.rejects(verify(token({}, { kid: 'kid-unknown' })), /unknown key/);
  await assert.rejects(verify(token({}, { alg: 'none' })), /algorithm/);
  await assert.rejects(verify('not-a-token'), /Malformed/);
});

test('without a project id the server refuses rather than guessing', async () => {
  await assert.rejects(verifyFirebaseToken(token(), { projectId: '', getKeys, now: NOW }), /project ID/);
});
