import test from 'node:test';
import assert from 'node:assert/strict';

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

function jsonResponse(obj, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => obj,
  };
}

/** Import a module bypassing the ESM cache so module-level state is fresh. */
let importCounter = 0;
async function freshImport(rel) {
  const url = new URL(rel, import.meta.url);
  url.searchParams.set('fresh', String(++importCounter));
  return import(url.href);
}

const TOKEN_OK = () =>
  jsonResponse({
    access_token: 'TOKEN-A',
    expiry_timestamp: String(Math.floor(Date.now() / 1000) + 3 * 86400),
  });

// ── token management ──────────────────────────────────────────────────────

test('getOneMapToken caches the token across calls', async (t) => {
  process.env.ONEMAP_EMAIL = 'a@b.c';
  process.env.ONEMAP_PASSWORD = 'pw';
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return TOKEN_OK();
  };
  t.after(() => delete globalThis.fetch);

  const { getOneMapToken } = await freshImport('../api/_lib/token.js');
  assert.equal(await getOneMapToken(), 'TOKEN-A');
  assert.equal(await getOneMapToken(), 'TOKEN-A');
  assert.equal(calls.length, 1, 'token endpoint should be called only once');
});

test('getOneMapToken refreshes when the cached token is near expiry', async (t) => {
  process.env.ONEMAP_EMAIL = 'a@b.c';
  process.env.ONEMAP_PASSWORD = 'pw';
  let n = 0;
  globalThis.fetch = async () =>
    jsonResponse({
      access_token: `TOKEN-${++n}`,
      // expires in 1 hour — inside the 6-hour refresh buffer
      expiry_timestamp: String(Math.floor(Date.now() / 1000) + 3600),
    });
  t.after(() => delete globalThis.fetch);

  const { getOneMapToken } = await freshImport('../api/_lib/token.js');
  await getOneMapToken();
  await getOneMapToken();
  assert.equal(n, 2, 'near-expiry token should be re-fetched');
});

test('getOneMapToken fails clearly when credentials are missing', async () => {
  delete process.env.ONEMAP_EMAIL;
  delete process.env.ONEMAP_PASSWORD;
  const { getOneMapToken } = await freshImport('../api/_lib/token.js');
  await assert.rejects(getOneMapToken, /ONEMAP_EMAIL and ONEMAP_PASSWORD/);
});

test('oneMapFetch retries with Bearer style, then a refreshed token, on 401', async (t) => {
  process.env.ONEMAP_EMAIL = 'a@b.c';
  process.env.ONEMAP_PASSWORD = 'pw';
  const authHeaders = [];
  let tokenCalls = 0;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('getToken')) {
      tokenCalls += 1;
      return jsonResponse({
        access_token: `T${tokenCalls}`,
        expiry_timestamp: String(Math.floor(Date.now() / 1000) + 3 * 86400),
      });
    }
    authHeaders.push(opts.headers.Authorization);
    // raw T1 → 401, Bearer T1 → 401, raw T2 → 200
    return authHeaders.length < 3 ? jsonResponse({}, 401) : jsonResponse({ ok: 1 });
  };
  t.after(() => delete globalThis.fetch);

  const { oneMapFetch } = await freshImport('../api/_lib/token.js');
  const res = await oneMapFetch('https://example.test/data');
  assert.equal(res.status, 200);
  assert.deepEqual(authHeaders, ['T1', 'Bearer T1', 'T2']);
  assert.equal(tokenCalls, 2);
});

// ── /api/search ───────────────────────────────────────────────────────────

function onemapFetchMock({ searchResponse, routeResponse }) {
  return async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('getToken')) return TOKEN_OK();
    if (u.includes('elastic/search')) return searchResponse(u, opts);
    if (u.includes('routingsvc')) return routeResponse(u, opts);
    throw new Error(`unexpected fetch: ${u}`);
  };
}

test('search rejects short queries', async () => {
  const { default: handler } = await freshImport('../api/search.js');
  const res = mockRes();
  await handler({ query: { q: 'ab' } }, res);
  assert.equal(res.statusCode, 400);
});

test('search maps OneMap results into clean pins', async (t) => {
  process.env.ONEMAP_EMAIL = 'a@b.c';
  process.env.ONEMAP_PASSWORD = 'pw';
  globalThis.fetch = onemapFetchMock({
    searchResponse: () =>
      jsonResponse({
        found: 2,
        results: [
          {
            SEARCHVAL: '5 ELIAS ROAD',
            ADDRESS: '5 ELIAS ROAD SINGAPORE 519932',
            POSTAL: '519932',
            LATITUDE: '1.3745',
            LONGITUDE: '103.9448',
          },
          {
            SEARCHVAL: 'BAD ROW',
            ADDRESS: 'NO COORDS',
            POSTAL: 'NIL',
            LATITUDE: 'NaN',
            LONGITUDE: '',
          },
        ],
      }),
  });
  t.after(() => delete globalThis.fetch);

  const { default: handler } = await freshImport('../api/search.js');
  const res = mockRes();
  await handler({ query: { q: '5 elias road' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.results.length, 1, 'row without coordinates is dropped');
  assert.deepEqual(res.body.results[0], {
    label: '5 ELIAS ROAD',
    address: '5 ELIAS ROAD SINGAPORE 519932',
    postal: '519932',
    lat: 1.3745,
    lng: 103.9448,
  });
  assert.ok(res.headers['Cache-Control']);
});

test('search surfaces OneMap "200 + error body" auth failures after one retry', async (t) => {
  process.env.ONEMAP_EMAIL = 'a@b.c';
  process.env.ONEMAP_PASSWORD = 'pw';
  let searchCalls = 0;
  globalThis.fetch = onemapFetchMock({
    searchResponse: () => {
      searchCalls += 1;
      return jsonResponse({ error: 'Authentication token missing.', found: 0, results: [] });
    },
  });
  t.after(() => delete globalThis.fetch);

  const { default: handler } = await freshImport('../api/search.js');
  const res = mockRes();
  await handler({ query: { q: '5 elias road' } }, res);
  assert.equal(res.statusCode, 502);
  assert.match(res.body.error, /OneMap: Authentication token missing/);
  assert.equal(searchCalls, 2, 'should retry once with a refreshed token');
});

// ── /api/route ────────────────────────────────────────────────────────────

test('route validates coordinates', async () => {
  const { default: handler } = await freshImport('../api/route.js');
  const res = mockRes();
  await handler({ query: { start: 'nonsense', end: '1.3,103.9' } }, res);
  assert.equal(res.statusCode, 400);
});

test('route returns rounded km and minutes', async (t) => {
  process.env.ONEMAP_EMAIL = 'a@b.c';
  process.env.ONEMAP_PASSWORD = 'pw';
  globalThis.fetch = onemapFetchMock({
    routeResponse: () =>
      jsonResponse({
        route_summary: { total_distance: 7845, total_time: 540 },
      }),
  });
  t.after(() => delete globalThis.fetch);

  const { default: handler } = await freshImport('../api/route.js');
  const res = mockRes();
  await handler({ query: { start: '1.3745,103.9448', end: '1.3736,103.944' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { km: 7.8, mins: 9 });
});

test('route pt mode returns minutes, transfers, and compact legs', async (t) => {
  process.env.ONEMAP_EMAIL = 'a@b.c';
  process.env.ONEMAP_PASSWORD = 'pw';
  globalThis.fetch = onemapFetchMock({
    routeResponse: (u) => {
      assert.match(u, /routeType=pt/);
      assert.match(u, /date=08-25-2026/, 'date should be converted to MM-DD-YYYY');
      assert.match(u, /time=14:00:00/);
      return jsonResponse({
        plan: {
          itineraries: [
            {
              duration: 1920,
              transfers: 1,
              legs: [
                { mode: 'WALK', duration: 240, to: { name: 'AFT ELIAS RD' } },
                { mode: 'BUS', duration: 600, route: '89', to: { name: 'PASIR RIS INT' } },
                { mode: 'SUBWAY', duration: 900, route: 'EW', to: { name: 'TAMPINES MRT STATION' } },
                { mode: 'WALK', duration: 30, to: { name: 'DESTINATION' } },
              ],
            },
            { duration: 2400, transfers: 2, legs: [] },
          ],
        },
      });
    },
  });
  t.after(() => delete globalThis.fetch);

  const { default: handler } = await freshImport('../api/route.js');
  const res = mockRes();
  await handler(
    {
      query: {
        start: '1.3745,103.9448',
        end: '1.3300,103.9270',
        mode: 'pt',
        date: '2026-08-25',
        time: '14:00',
      },
    },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mins, 32, 'fastest itinerary wins');
  assert.equal(res.body.transfers, 1);
  assert.deepEqual(res.body.legs, [
    { type: 'walk', mins: 4 },
    { type: 'bus', label: 'Bus 89', alight: 'Pasir Ris Int', mins: 10 },
    { type: 'train', label: 'EW line', alight: 'Tampines MRT Station', mins: 15 },
  ]);
});

test('route pt mode requires a valid date and time', async () => {
  const { default: handler } = await freshImport('../api/route.js');
  const res = mockRes();
  await handler(
    { query: { start: '1.37,103.94', end: '1.33,103.92', mode: 'pt', date: 'today', time: '2pm' } },
    res
  );
  assert.equal(res.statusCode, 400);
});

test('route reports when no route exists', async (t) => {
  process.env.ONEMAP_EMAIL = 'a@b.c';
  process.env.ONEMAP_PASSWORD = 'pw';
  globalThis.fetch = onemapFetchMock({
    routeResponse: () => jsonResponse({ status: 'error' }),
  });
  t.after(() => delete globalThis.fetch);

  const { default: handler } = await freshImport('../api/route.js');
  const res = mockRes();
  await handler({ query: { start: '1.3745,103.9448', end: '1.3736,103.944' } }, res);
  assert.equal(res.statusCode, 502);
});

// ── transit accuracy ──────────────────────────────────────────────────────
//
// OneMap answers a public-transport query it cannot satisfy by walking you the
// whole way rather than saying no, and it has no timetable at all beyond about
// a fortnight. Both come back as numbers that look like real journeys.

const WALK_ONLY = {
  duration: 11280, // ≈188 min — a 13 km walk, which is what this really is
  transfers: 0,
  walkTime: 11280,
  legs: [{ mode: 'WALK', duration: 11280, to: { name: 'DESTINATION' } }],
};

const BY_BUS = {
  duration: 2640,
  transfers: 0,
  walkTime: 480,
  waitingTime: 360,
  transitTime: 1800,
  startTime: Date.UTC(2026, 7, 28, 5, 16), // 13:16 SGT
  endTime: Date.UTC(2026, 7, 28, 6, 0), //   14:00 SGT
  legs: [
    { mode: 'WALK', duration: 300, to: { name: 'OPP BLK 123' } },
    { mode: 'BUS', duration: 1800, route: '54', to: { name: 'BEF NEWTON STN' } },
    { mode: 'WALK', duration: 180, to: { name: 'DESTINATION' } },
  ],
};

/** Drive the pt handler with a canned sequence of OneMap responses. */
async function ptCall(query, replies) {
  const seen = [];
  globalThis.fetch = onemapFetchMock({
    routeResponse: (u) => {
      seen.push(u);
      const next = replies[Math.min(seen.length - 1, replies.length - 1)];
      return jsonResponse(next);
    },
  });
  const { default: handler } = await freshImport('../api/route.js');
  const res = mockRes();
  await handler({ query: { mode: 'pt', ...query } }, res);
  delete globalThis.fetch;
  return { res, seen };
}

const PT_BASE = {
  start: '1.3745,103.9448',
  end: '1.3300,103.9270',
  date: '2026-08-28',
  time: '14:00',
};

test('route pt refuses a walk-the-whole-way itinerary', async () => {
  const { res, seen } = await ptCall(PT_BASE, [{ plan: { itineraries: [WALK_ONLY] } }]);
  assert.equal(res.statusCode, 502, 'a three-hour walk is not a transit answer');
  assert.match(res.body.error, /No public transport route/);
  assert.ok(seen.length > 1, 'a wider walking allowance should be tried first');
});

test('route pt widens the walking allowance before giving up', async () => {
  const { res, seen } = await ptCall(PT_BASE, [
    { plan: { itineraries: [WALK_ONLY] } },
    { plan: { itineraries: [WALK_ONLY, BY_BUS] } },
  ]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mins, 44, 'the bus journey wins, not the 188-minute walk');
  assert.match(seen[0], /maxWalkDistance=1000/);
  assert.match(seen[1], /maxWalkDistance=2000/);
});

test('route pt reports walking, waiting and the clock times', async () => {
  const { res } = await ptCall({ ...PT_BASE, by: 'arrive' }, [
    { plan: { itineraries: [BY_BUS] } },
  ]);
  assert.equal(res.body.walkMins, 8);
  assert.equal(res.body.waitMins, 6);
  assert.equal(res.body.departAt, '13:16');
  assert.equal(res.body.arriveAt, '14:00');
  assert.equal(res.body.arrivesInTime, true, 'this plan lands by the time asked for');
});

test('route pt asks to arrive by the time given, and stops if refused', async () => {
  const ok = await ptCall({ ...PT_BASE, by: 'arrive' }, [{ plan: { itineraries: [BY_BUS] } }]);
  assert.match(ok.seen[0], /arriveBy=true/);

  // OneMap rejecting the parameter must degrade, not break the feature.
  let n = 0;
  globalThis.fetch = onemapFetchMock({
    routeResponse: (u) => {
      n += 1;
      if (/arriveBy/.test(u)) return jsonResponse({ error: 'unknown parameter' });
      return jsonResponse({ plan: { itineraries: [BY_BUS] } });
    },
  });
  const { default: handler } = await freshImport('../api/route.js');
  const res = mockRes();
  await handler({ query: { mode: 'pt', ...PT_BASE, by: 'arrive' } }, res);
  delete globalThis.fetch;
  assert.equal(res.statusCode, 200, 'falls back to a plain departure query');
  assert.equal(res.body.mins, 44);
  assert.equal(n, 2);
});

test('leaving somewhere is not the same question as getting to it', async () => {
  // Leaving a visit at 3pm is a departure. Asking OneMap to have you *arrive*
  // by 3pm would answer a different journey entirely.
  const leaving = await ptCall(PT_BASE, [{ plan: { itineraries: [BY_BUS] } }]);
  assert.doesNotMatch(leaving.seen[0], /arriveBy/, 'departures are planned forwards');
  assert.equal(leaving.res.body.arrivesInTime, false, 'so there is no "leave by" to promise');

  const arriving = await ptCall({ ...PT_BASE, by: 'arrive' }, [
    { plan: { itineraries: [BY_BUS] } },
  ]);
  assert.match(arriving.seen[0], /arriveBy=true/);
  assert.equal(arriving.res.body.arrivesInTime, true);
  assert.equal(arriving.res.body.departAt, '13:16', 'which is the time worth showing a rep');
});

test('route pt rejects a nonsense by value rather than guessing', async () => {
  const { default: handler } = await freshImport('../api/route.js');
  const res = mockRes();
  await handler({ query: { mode: 'pt', ...PT_BASE, by: 'whenever' } }, res);
  assert.equal(res.statusCode, 400);
});

test('route pt borrows the same weekday when a date is past the timetable', async () => {
  // Derived from today rather than hard-coded, so this keeps testing the same
  // thing next month: a visit five weeks out, and the next matching weekday.
  const day = 86400000;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const todayMs = Date.parse(`${new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
  }).format(new Date())}T00:00:00Z`);
  const farDate = iso(todayMs + 35 * day); // same weekday as today, 5 weeks on
  const expected = iso(todayMs); //           so the stand-in is today itself
  const [ey, em, ed] = expected.split('-');

  const { res, seen } = await ptCall({ ...PT_BASE, date: farDate }, [
    { plan: { itineraries: [BY_BUS] } },
  ]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.approx, true, 'flagged as typical, not exact');
  assert.equal(res.body.plannedFor, expected);
  assert.ok(seen[0].includes(`date=${em}-${ed}-${ey}`), 'planned against the stand-in date');
  assert.equal(seen.length, 1, 'no wasted call on the unplannable date');
});

test('sameWeekdayNear keeps the weekday and never goes backwards', async () => {
  const { sameWeekdayNear } = await freshImport('../api/route.js');
  // 2026-08-27 is a Thursday.
  assert.equal(sameWeekdayNear('2026-09-24', '2026-08-27'), '2026-08-27', 'Thu → today');
  assert.equal(sameWeekdayNear('2026-09-29', '2026-08-27'), '2026-09-01', 'Tue → next Tue');
  assert.equal(sameWeekdayNear('2026-12-25', '2026-08-27'), '2026-08-28', 'Fri → tomorrow');
  for (const d of ['2026-09-24', '2026-09-29', '2026-12-25']) {
    const near = sameWeekdayNear(d, '2026-08-27');
    assert.equal(
      new Date(`${near}T00:00:00Z`).getUTCDay(),
      new Date(`${d}T00:00:00Z`).getUTCDay(),
      'weekday preserved'
    );
    assert.ok(near >= '2026-08-27', 'never earlier than today');
  }
});

test('transit answers are not cached as long as road ones', async () => {
  const { res } = await ptCall(PT_BASE, [{ plan: { itineraries: [BY_BUS] } }]);
  assert.match(res.headers['Cache-Control'], /s-maxage=86400/);
});
