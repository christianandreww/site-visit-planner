import { oneMapFetch } from './_lib/token.js';

const COORD = /^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const BASE = 'https://www.onemap.gov.sg/api/public/routingsvc/route';
const TZ = 'Asia/Singapore';
const SGT = '+08:00';

// How far OneMap may make you walk at each end of a journey, in metres.
// This matters more than it looks: when it cannot link both ends to the
// network within this distance it does not give up, it quietly returns an
// itinerary that walks the entire way. A tight first attempt keeps journeys
// realistic; a looser second one runs only when the tight one found nothing.
const WALK_TIGHT = 1000;
const WALK_LOOSE = 2000;

// Bus and train timetables are only published a couple of weeks out. Past that
// there is nothing to plan against, so the same weekday in the coming week
// stands in and the answer is flagged as typical rather than exact.
const SCHEDULE_HORIZON_DAYS = 10;

// OneMap's router can in principle plan backwards from an arrival time, and
// the request is still sent in case it starts doing so. In practice (checked
// against the live service, Sept 2026) it accepts `arriveBy=true` and quietly
// plans a departure at that time instead — so arrivals are worked out here,
// in arriveInTime() below, rather than trusted to OneMap.
//
// Probed once per cold start: if the parameter is ever rejected, stop sending.
let arriveBySupported = true;

// How much earlier than "deadline minus the trip" to look for a journey that
// still arrives in time. Five minutes absorbs ordinary timetable wobble on
// trains every few minutes; twenty covers buses that run a few times an hour,
// where the last one that makes it can leave well before the obvious time.
const LEAD_BUFFERS_MINS = [5, 20];

// ── small date helpers (server-side, all pinned to Singapore) ──────────────

const epochSG = (dateISO, timeHM) => new Date(`${dateISO}T${timeHM}:00${SGT}`).getTime();

const todaySG = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

const dayNumber = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
};

const isoFromDayNumber = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

/**
 * A Singapore date and time moved by some minutes, rolling over midnight and
 * month ends. Singapore has no daylight saving, so a fixed +8h is exact.
 */
export function shiftSG(dateISO, timeHM, deltaMins) {
  const wall = new Date(epochSG(dateISO, timeHM) + deltaMins * 60_000 + 8 * 3_600_000);
  const iso = wall.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** 'HH:MM' in Singapore for an epoch-millisecond timestamp. */
function hhmmSG(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(n));
}

/**
 * The nearest date sharing a weekday with `dateISO`, from `fromISO` onwards.
 * Timetables repeat weekly, so a visit too far out to have published schedules
 * can borrow the coming week's — a Thursday answers for every later Thursday.
 */
export function sameWeekdayNear(dateISO, fromISO) {
  const delta = (((dayNumber(dateISO) - dayNumber(fromISO)) % 7) + 7) % 7;
  return isoFromDayNumber(dayNumber(fromISO) + delta);
}

// ── reading OneMap's itineraries ──────────────────────────────────────────

const isTransitLeg = (leg) => Boolean(leg && leg.mode && leg.mode !== 'WALK');

/**
 * Does this itinerary actually put you on a bus or train?
 *
 * When OneMap cannot find one it returns a walk-the-whole-way itinerary
 * instead of an empty result. Reported as "public transport" that reads as a
 * plausible number — a 13 km trip comes back as ~188 minutes — while really
 * being a three-hour walk. Those are dropped rather than shown.
 */
const usesTransit = (it) => (it.legs || []).some(isTransitLeg);

const seconds = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : Infinity;
};

const toMins = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n / 60)) : 0;
};

/** Itineraries that really use a bus or train and say how long they take. */
const realJourneys = (itineraries) =>
  (itineraries || []).filter((it) => usesTransit(it) && Number.isFinite(Number(it.duration)));

/** Fastest itinerary that involves transit, or null if none do. */
function bestItinerary(itineraries) {
  const real = realJourneys(itineraries);
  if (!real.length) return null;
  return real.reduce((a, b) => (seconds(a.duration) <= seconds(b.duration) ? a : b));
}

/** Does this itinerary reach its destination by `deadline` (epoch ms)? */
const arrivesBy = (it, deadline) => Number(it.endTime) > 0 && Number(it.endTime) <= deadline;

// A minute's grace, so a plan landing at 2:00:30 still counts for a 2:00 visit.
const GRACE_MS = 60_000;

// "PASIR RIS MRT STATION" → "Pasir Ris MRT Station" (keeps common SG abbreviations)
const KEEP_UPPER = new Set([
  'MRT', 'LRT', 'CTE', 'PIE', 'AYE', 'KPE', 'TPE', 'SLE', 'BKE', 'ECP', 'MCE',
]);
function prettyName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .split(/\s+/)
    .map((w) => {
      const up = w.toUpperCase();
      if (KEEP_UPPER.has(up)) return up;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

/** Squash an itinerary's legs into what a rep actually needs to know. */
function compactLegs(itinerary) {
  const legs = [];
  for (const leg of itinerary.legs || []) {
    const mins = Math.max(1, Math.round(Number(leg.duration) / 60));
    if (leg.mode === 'WALK') {
      if (Number(leg.duration) < 60) continue; // skip sub-minute shuffles
      const prev = legs[legs.length - 1];
      if (prev && prev.type === 'walk') prev.mins += mins;
      else legs.push({ type: 'walk', mins });
    } else if (leg.mode === 'BUS') {
      legs.push({
        type: 'bus',
        label: `Bus ${leg.route}`,
        alight: prettyName(leg.to && leg.to.name),
        mins,
      });
    } else if (leg.mode === 'SUBWAY' || leg.mode === 'RAIL' || leg.mode === 'TRAM') {
      legs.push({
        type: 'train',
        label: leg.route ? `${String(leg.route).toUpperCase()} line` : 'Train',
        alight: prettyName(leg.to && leg.to.name),
        mins,
      });
    } else {
      legs.push({
        type: 'other',
        label: prettyName(leg.mode),
        alight: prettyName(leg.to && leg.to.name),
        mins,
      });
    }
  }
  return legs;
}

// ── talking to OneMap ─────────────────────────────────────────────────────

function ptUrl(start, end, dateISO, timeHM, { maxWalk, arriveBy }) {
  const [y, m, d] = dateISO.split('-');
  return (
    `${BASE}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}` +
    `&routeType=pt&date=${m}-${d}-${y}&time=${timeHM}:00` +
    `&mode=TRANSIT&maxWalkDistance=${maxWalk}&numItineraries=3` +
    (arriveBy ? '&arriveBy=true' : '')
  );
}

/** One request. Returns the parsed body, or throws with a readable message. */
async function fetchPlan(url) {
  const upstream = await oneMapFetch(url);
  if (!upstream.ok) {
    throw new Error(`OneMap routing failed (HTTP ${upstream.status}).`);
  }
  let data = await upstream.json();

  // OneMap sometimes reports auth problems as HTTP 200 + an "error" field.
  if (data && data.error && /token|auth/i.test(String(data.error))) {
    const retry = await oneMapFetch(url, { forceRefresh: true });
    data = await retry.json().catch(() => data);
  }
  if (data && data.error) throw new Error(`OneMap: ${data.error}`);
  return data;
}

/** Itineraries for one date / walking allowance, with the arriveBy probe. */
async function itinerariesFor(start, end, dateISO, timeHM, maxWalk, wantArrive) {
  const ask = (arriveBy) => fetchPlan(ptUrl(start, end, dateISO, timeHM, { maxWalk, arriveBy }));
  if (!wantArrive) return unwrap(await ask(false));
  let data;
  if (arriveBySupported) {
    try {
      data = await ask(true);
    } catch (err) {
      // Only conclude the parameter is unwelcome if the identical request
      // works without it. A network blip should not disable the feature for
      // the rest of this instance's life.
      data = await ask(false);
      arriveBySupported = false;
    }
  } else {
    data = await ask(false);
  }
  return unwrap(data);
}

const unwrap = (data) => (data && data.plan && data.plan.itineraries) || [];

/**
 * Plan a public-transport journey, working around the two ways OneMap answers
 * unhelpfully: walking the whole way when it cannot reach the network, and
 * having no timetable at all for dates beyond the published horizon.
 *
 * `timeHM` is the moment that matters, and `wantArrive` says which end of the
 * journey it pins. Travelling *to* an appointment, it is the time you must be
 * there by; leaving one, it is the time you set off. Getting this backwards is
 * how "13 minutes to a 2pm visit" quietly comes to mean "leave at 2pm".
 */
async function planTransit(start, end, dateISO, timeHM, wantArrive) {
  const today = todaySG();
  const daysOut = dayNumber(dateISO) - dayNumber(today);
  const beyondHorizon = daysOut > SCHEDULE_HORIZON_DAYS;
  const standIn = sameWeekdayNear(dateISO, today);

  // Each attempt is only made if the previous one found nothing usable.
  const attempts = beyondHorizon
    ? [
        { date: standIn, maxWalk: WALK_TIGHT, approx: true },
        { date: standIn, maxWalk: WALK_LOOSE, approx: true },
      ]
    : [
        { date: dateISO, maxWalk: WALK_TIGHT, approx: false },
        { date: dateISO, maxWalk: WALK_LOOSE, approx: false },
        // A date inside the horizon can still fall outside it — the timetable
        // may simply stop earlier than expected. Try the coming week too.
        ...(daysOut > 0 && standIn !== dateISO
          ? [{ date: standIn, maxWalk: WALK_LOOSE, approx: true }]
          : []),
      ];

  for (const attempt of attempts) {
    const itineraries = await itinerariesFor(
      start,
      end,
      attempt.date,
      timeHM,
      attempt.maxWalk,
      wantArrive
    );
    const best = bestItinerary(itineraries);
    if (best) return { best, ...attempt };
  }
  return null;
}

/**
 * Turn "a journey at about this time" into "the journey that gets you there
 * in time" — which is what a rep needs for an appointment.
 *
 * OneMap plans forwards only, so ask it again with an earlier departure: the
 * appointment time, less the trip it just found, less a margin. Of the
 * journeys that come back, keep the one that leaves *latest* while still
 * arriving by the deadline — that is the honest "leave by" time. If even a
 * generous margin finds nothing that makes it, the forward plan is returned
 * unchanged, and the interface shows no "leave by" at all rather than a guess.
 *
 * The deadline is measured on the date actually planned, which for a visit
 * beyond the timetable horizon is the stand-in weekday, not the real one.
 */
async function arriveInTime(start, end, found, timeHM) {
  const deadline = epochSG(found.date, timeHM) + GRACE_MS;
  if (arrivesBy(found.best, deadline)) return found; // already in time

  const tripMins = Math.ceil(seconds(found.best.duration) / 60);
  for (const buffer of LEAD_BUFFERS_MINS) {
    const leave = shiftSG(found.date, timeHM, -(tripMins + buffer));
    let itineraries;
    try {
      itineraries = await itinerariesFor(start, end, leave.date, leave.time, found.maxWalk, false);
    } catch {
      return found; // a hiccup while refining should not cost the answer already in hand
    }
    const inTime = realJourneys(itineraries).filter((it) => arrivesBy(it, deadline));
    if (inTime.length) {
      const latest = inTime.reduce((a, b) => {
        const later = Number(b.startTime) - Number(a.startTime);
        if (later !== 0) return later > 0 ? b : a;
        return seconds(b.duration) < seconds(a.duration) ? b : a; // same time: quicker
      });
      return { ...found, best: latest };
    }
  }
  return found;
}

/**
 * GET /api/route?start=<lat,lng>&end=<lat,lng>            → driving: { km, mins }
 * GET /api/route?...&mode=pt&date=YYYY-MM-DD&time=HH:MM   → public transport:
 *       { mins, transfers, walkMins, waitMins, departAt, arriveAt,
 *         legs: [{type, label, alight, mins}], approx?, plannedFor? }
 *
 * `by=arrive` treats the time as a deadline to be there by; `by=depart` (the
 * default) treats it as when you set off. Transit is timed either way, since
 * bus and train schedules differ hour to hour.
 */
export default async function handler(req, res) {
  const start = String(req.query.start || '').trim();
  const end = String(req.query.end || '').trim();
  const mode = String(req.query.mode || 'drive').trim();
  if (!COORD.test(start) || !COORD.test(end)) {
    return res.status(400).json({ error: 'start and end must be "lat,lng".' });
  }
  if (mode !== 'drive' && mode !== 'pt') {
    return res.status(400).json({ error: 'mode must be "drive" or "pt".' });
  }

  try {
    if (mode === 'pt') {
      const date = String(req.query.date || '').trim();
      const time = String(req.query.time || '').trim();
      if (!DATE_RE.test(date) || !TIME_RE.test(time)) {
        return res
          .status(400)
          .json({ error: 'pt mode needs date=YYYY-MM-DD and time=HH:MM.' });
      }

      const by = String(req.query.by || 'depart').trim();
      if (by !== 'arrive' && by !== 'depart') {
        return res.status(400).json({ error: 'by must be "arrive" or "depart".' });
      }

      let found = await planTransit(start, end, date, time, by === 'arrive');
      if (!found) {
        return res.status(502).json({ error: 'No public transport route found.' });
      }
      if (by === 'arrive') found = await arriveInTime(start, end, found, time);
      const { best, approx } = found;

      // Timetables shift; do not hold a transit answer as long as a road one.
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=86400');

      // Measured on the date actually planned: for a far-off visit that is the
      // stand-in weekday, and comparing against the real (later) date would
      // make every journey look early.
      const deadline = epochSG(found.date, time) + GRACE_MS;
      const arriveAt = hhmmSG(best.endTime);
      const departAt = hhmmSG(best.startTime);
      return res.status(200).json({
        mins: Math.max(1, toMins(best.duration)),
        transfers: Number(best.transfers) || 0,
        walkMins: toMins(best.walkTime),
        waitMins: toMins(best.waitingTime),
        departAt,
        arriveAt,
        // True when the plan really does land by the deadline asked for, so
        // the interface can say "leave by" rather than merely implying it.
        arrivesInTime: by === 'arrive' && arrivesBy(best, deadline),
        legs: compactLegs(best),
        ...(approx ? { approx: true, plannedFor: found.date } : {}),
      });
    }

    const data = await fetchPlan(
      `${BASE}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&routeType=drive`
    );
    const summary = data.route_summary;
    if (!summary) {
      return res.status(502).json({ error: 'No route found between these points.' });
    }
    // Roads do not keep a timetable — this answer stays good for a while.
    res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=604800');
    return res.status(200).json({
      km: Math.round((Number(summary.total_distance) / 1000) * 10) / 10,
      mins: Math.max(1, Math.round(Number(summary.total_time) / 60)),
    });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Routing failed.' });
  }
}
