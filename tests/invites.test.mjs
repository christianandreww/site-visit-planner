import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInvitesHandler, parseAliases, clientName } from '../api/invites.js';

// ── helpers ───────────────────────────────────────────────────────────────

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(o) {
      this.body = o;
      return this;
    },
  };
}

const FEED_URL = 'https://calendar.google.com/calendar/ical/planner%40example/private-abc/basic.ics';
const NOW = Date.UTC(2026, 9, 1, 4, 0, 0); // Thu 1 Oct 2026, 12pm SGT

/** The planner calendar, as Google would export it, with one event per case. */
function feed(events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART:${e.start}`, `DTEND:${e.end}`);
    lines.push(`ORGANIZER;CN=Someone:mailto:${e.organizer}`);
    lines.push('ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:planner@example.com');
    lines.push(`SUMMARY:${e.summary}`);
    if (e.location) lines.push(`LOCATION:${e.location}`);
    if (e.status) lines.push(`STATUS:${e.status}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

const JASON = 'jason@getsolar.example';

const EVENTS = [
  // Fri 2 Oct, 2–3pm SGT, with a postal code: should land on the map.
  { uid: 'visit-tan', start: '20261002T060000Z', end: '20261002T070000Z', organizer: JASON,
    summary: 'Site visit – Mr Tan', location: 'Blk 123 Serangoon Ave 3\\, #05-12\\, Singapore 550123' },
  // An address OneMap can't find.
  { uid: 'visit-lost', start: '20261003T020000Z', end: '20261003T030000Z', organizer: JASON,
    summary: 'Site visit – Mdm Lee', location: 'Nowhere Land' },
  // No address at all.
  { uid: 'visit-blank', start: '20261003T060000Z', end: '20261003T070000Z', organizer: JASON,
    summary: 'Site visit – Mr Ong' },
  // Another rep's visit, a cancelled one, one already over, and a stranger's invite.
  { uid: 'boss', start: '20261002T020000Z', end: '20261002T030000Z', organizer: 'boss@getsolar.example',
    summary: 'Site visit – Boss client', location: 'Singapore 018956' },
  { uid: 'cancelled', start: '20261004T020000Z', end: '20261004T030000Z', organizer: JASON,
    summary: 'Site visit – Called off', location: 'Singapore 550123', status: 'CANCELLED' },
  { uid: 'yesterday', start: '20260930T020000Z', end: '20260930T030000Z', organizer: JASON,
    summary: 'Site visit – Done', location: 'Singapore 550123' },
  { uid: 'spam', start: '20261002T020000Z', end: '20261002T030000Z', organizer: 'prize@scam.example',
    summary: 'You won!', location: 'Singapore 550123' },
];

/** Answers every outside call the endpoint makes: the feed, OneMap login, OneMap search. */
function mockFetch({ feedText = feed(EVENTS), feedStatus = 200, searchFails = false } = {}) {
  const seen = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    seen.push(u);
    if (u === FEED_URL) {
      return { ok: feedStatus === 200, status: feedStatus, text: async () => feedText };
    }
    if (u.includes('getToken')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'T', expiry_timestamp: String(Math.floor(Date.now() / 1000) + 86400) }),
      };
    }
    if (u.includes('elastic/search')) {
      if (searchFails) return { ok: false, status: 503, json: async () => ({}) };
      const q = decodeURIComponent(/searchVal=([^&]+)/.exec(u)[1]);
      // What OneMap knows. "99 Imaginary Road" stands for a search OneMap
      // answers with a *different* building — the case that must not be trusted.
      const known = {
        550123: { blk: '123', road: 'SERANGOON AVENUE 3', lat: '1.3601', lng: '103.8690' },
        550124: { blk: '124', road: 'SERANGOON AVENUE 3', lat: '1.3602', lng: '103.8691' },
        '21 Lower Kent Ridge Road': { blk: '21', road: 'LOWER KENT RIDGE ROAD', postal: '119077', lat: '1.2966', lng: '103.7764' },
        '99 Imaginary Road': { blk: '12', road: 'IMAGINARY ROAD', postal: '123456', lat: '1.3000', lng: '103.8000' },
      };
      const hit = known[q];
      const postal = hit && (hit.postal || q);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: hit
            ? [{
                BLK_NO: hit.blk,
                ADDRESS: `${hit.blk} ${hit.road} SINGAPORE ${postal}`,
                POSTAL: postal,
                LATITUDE: hit.lat,
                LONGITUDE: hit.lng,
              }]
            : [],
        }),
      };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  return seen;
}

/** Runs the endpoint as `email`, with the environment as configured for a test run. */
async function call({ email = JASON, auth = 'Bearer good', env = {}, verify } = {}) {
  const saved = { ...process.env };
  Object.assign(process.env, {
    PLANNER_ICAL_URL: FEED_URL,
    PLANNER_EMAIL: 'planner@example.com',
    VITE_FIREBASE_PROJECT_ID: 'svp-test',
    ONEMAP_EMAIL: 'a@b.c',
    ONEMAP_PASSWORD: 'pw',
    ...env,
  });
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  const handler = makeInvitesHandler({
    clock: () => NOW,
    verify:
      verify ||
      (async (token, { projectId }) => {
        assert.equal(projectId, 'svp-test', 'the Firebase project id comes from the existing setting');
        if (token !== 'good') throw new Error('Token signature does not match.');
        return { uid: 'u1', email, emailVerified: true };
      }),
  });
  const res = mockRes();
  try {
    await handler({ headers: auth ? { authorization: auth } : {}, query: {} }, res);
  } finally {
    process.env = saved;
    delete globalThis.fetch;
  }
  return res;
}

// ── the endpoint ──────────────────────────────────────────────────────────

test('stays switched off until a planner calendar is configured', async () => {
  const seen = mockFetch();
  const res = await call({ env: { PLANNER_ICAL_URL: undefined } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { enabled: false, plannerEmail: '', visits: [], unplaced: [] });
  assert.equal(seen.length, 0, 'nothing is fetched');
});

test('only a signed-in rep is answered', async () => {
  mockFetch();
  assert.equal((await call({ auth: '' })).statusCode, 401);
  mockFetch();
  const forged = await call({ auth: 'Bearer forged' });
  assert.equal(forged.statusCode, 401);
  assert.match(forged.body.error, /signature/);
});

test("a rep gets exactly their own upcoming invites", async () => {
  const seen = mockFetch();
  const res = await call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.plannerEmail, 'planner@example.com', 'so the app can remind reps what to invite');

  assert.equal(res.body.visits.length, 1);
  const [v] = res.body.visits;
  assert.equal(v.name, 'Mr Tan', '"Site visit –" is dropped from the name');
  assert.equal(v.date, '2026-10-02');
  assert.equal(v.start, '14:00');
  assert.equal(v.end, '15:00');
  assert.equal(v.endTs, Date.UTC(2026, 9, 2, 7, 0, 0));
  assert.equal(v.address, 'Blk 123 Serangoon Ave 3, #05-12, Singapore 550123', "the rep's own wording, unit number included");
  assert.equal(v.postal, '550123');
  assert.deepEqual([v.lat, v.lng], [1.3601, 103.869]);
  assert.equal(v.fromCalendar, true);
  assert.match(v.id, /^cal_[0-9a-f]{16}$/);

  const reasons = Object.fromEntries(res.body.unplaced.map((u) => [u.name, u.reason]));
  assert.deepEqual(reasons, { 'Mdm Lee': 'not-found', 'Mr Ong': 'no-location' },
    "visits that can't be placed are listed, not silently dropped");

  const all = JSON.stringify(res.body);
  for (const absent of ['Boss client', 'Called off', 'Done', 'You won']) {
    assert.ok(!all.includes(absent), `"${absent}" must not appear`);
  }
  assert.ok(seen.some((u) => u.includes('searchVal=550123')), 'looked up by postal code');
});

test('the same event read twice keeps the same id', async () => {
  mockFetch();
  const a = await call();
  mockFetch();
  const b = await call();
  assert.equal(a.body.visits[0].id, b.body.visits[0].id, 'so the map does not flicker or duplicate on refresh');
});

test('a rep who signs in with one address and invites from another', async () => {
  const feedText = feed([
    { uid: 'w1', start: '20261002T060000Z', end: '20261002T070000Z', organizer: 'jason.work@getsolar.example',
      summary: 'Site visit – Ms Goh', location: 'Singapore 550124' },
  ]);
  mockFetch({ feedText });
  const without = await call({ email: 'jason.lim@gmail.example' });
  assert.equal(without.body.visits.length, 0, 'not matched unless the owner links the two');

  mockFetch({ feedText });
  const linked = await call({
    email: 'jason.lim@gmail.example',
    env: { PLANNER_EMAIL_ALIASES: 'Jason.Lim@gmail.example = jason.work@getsolar.example' },
  });
  assert.equal(linked.body.visits.length, 1);
  assert.equal(linked.body.visits[0].name, 'Ms Goh');
});

test('every answer is kept out of shared caches', async () => {
  mockFetch();
  assert.equal((await call()).headers['Cache-Control'], 'private, no-store');
  mockFetch();
  assert.equal((await call({ auth: '' })).headers['Cache-Control'], 'private, no-store');
});

test('a wrong calendar link says what to fix', async () => {
  mockFetch({ feedStatus: 404 });
  const res = await call();
  assert.equal(res.statusCode, 502);
  assert.match(res.body.error, /PLANNER_ICAL_URL/);
});

test('OneMap being down does not lose the visit', async () => {
  const feedText = feed([
    { uid: 'x', start: '20261002T060000Z', end: '20261002T070000Z', organizer: JASON,
      summary: 'Site visit – Mr Koh', location: 'Singapore 559999' },
  ]);
  mockFetch({ feedText, searchFails: true });
  const res = await call();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.unplaced.map((u) => [u.name, u.reason]), [['Mr Koh', 'lookup-failed']]);
});

// ── small pieces ──────────────────────────────────────────────────────────

test('alias lists are forgiving about spacing, case and separators', () => {
  const map = parseAliases(' A@x.com = b@y.com, c@y.com ;\n d@x.com=e@y.com ');
  assert.deepEqual(map.get('a@x.com'), ['b@y.com', 'c@y.com']);
  assert.deepEqual(map.get('d@x.com'), ['e@y.com']);
  assert.equal(parseAliases('').size, 0);
});

test('client names come from the event title', () => {
  assert.equal(clientName('Site visit – Mr Tan'), 'Mr Tan');
  assert.equal(clientName('site visit: Mdm Lee'), 'Mdm Lee');
  assert.equal(clientName('SITE VISIT - Ong'), 'Ong');
  assert.equal(clientName('Mr Tan roof check'), 'Mr Tan roof check', 'other titles are kept as written');
  assert.equal(clientName('Site visit'), 'Site visit');
  assert.equal(clientName(''), 'Site visit');
});

// ── addresses written into the title ──────────────────────────────────────

/** One event for Jason on Fri 2 Oct, 2–3pm, with the given title and Location. */
const one = (summary, location) =>
  feed([{ uid: `t-${summary}`, start: '20261002T060000Z', end: '20261002T070000Z', organizer: JASON, summary, location }]);

test('the title stands in when Location is empty', async () => {
  mockFetch({ feedText: one('Site visit – Mdm Wong, 550124') });
  const res = await call();
  assert.equal(res.body.visits.length, 1);
  const [v] = res.body.visits;
  assert.equal(v.name, 'Mdm Wong', 'the address is taken out of the name');
  assert.equal(v.address, '550124');
  assert.equal(v.postal, '550124');
  assert.deepEqual([v.lat, v.lng], [1.3602, 103.8691]);
});

test("the title is also the fallback when Location can't be found", async () => {
  mockFetch({ feedText: one('Mr Ng S550124', 'Her place, TBC') });
  const res = await call();
  assert.equal(res.body.visits.length, 1);
  assert.equal(res.body.visits[0].name, 'Mr Ng');
  assert.equal(res.body.visits[0].address, 'S550124');
  assert.equal(res.body.unplaced.length, 0);
});

test('Location wins when both have an address', async () => {
  mockFetch({ feedText: one('Mr Teo 550124', 'Singapore 550123') });
  const [v] = (await call()).body.visits;
  assert.equal(v.address, 'Singapore 550123');
  assert.deepEqual([v.lat, v.lng], [1.3601, 103.869], 'placed at the Location, not the title');
  assert.equal(v.name, 'Mr Teo', 'and the name still leaves the address out');
});

test('a street address in the title is used once OneMap confirms the block', async () => {
  const seen = mockFetch({ feedText: one('Site visit – Ms Lim, 21 Lower Kent Ridge Rd') });
  const res = await call();
  assert.equal(res.body.visits.length, 1);
  assert.equal(res.body.visits[0].name, 'Ms Lim');
  assert.equal(res.body.visits[0].postal, '119077', 'postal code taken from OneMap');
  assert.ok(seen.some((u) => u.includes(encodeURIComponent('21 Lower Kent Ridge Road'))), '"Rd" spelled out');
});

test('a street OneMap places at a different block is not trusted', async () => {
  mockFetch({ feedText: one('Mr Chua 99 Imaginary Rd') });
  const res = await call();
  assert.equal(res.body.visits.length, 0, 'no pin rather than a wrong one');
  assert.deepEqual(res.body.unplaced.map((u) => [u.name, u.reason, u.location]), [
    ['Mr Chua', 'not-found', '99 Imaginary Rd'],
  ]);
});
