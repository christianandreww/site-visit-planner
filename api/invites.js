import crypto from 'node:crypto';
import { parseIcs, sgDateTime } from './_lib/ics.js';
import { verifyFirebaseToken } from './_lib/firebaseAuth.js';
import { geocodeLocation } from './_lib/geocode.js';

/**
 * GET /api/invites  (Authorization: Bearer <Firebase ID token>)
 *
 * The planner has its own email address. When a rep invites that address to a
 * calendar event, Google puts the event in the planner's calendar. This reads
 * that calendar's private iCal feed and returns, to the rep who is asking,
 * the upcoming events *they* sent — ready to drop on their map.
 *
 * → { enabled, plannerEmail, visits: [...], unplaced: [...] }
 *
 * Configuration (Vercel → Settings → Environment Variables):
 *   PLANNER_ICAL_URL       the planner calendar's "Secret address in iCal format"
 *   PLANNER_EMAIL          the planner's address, shown to reps as a reminder
 *   PLANNER_EMAIL_ALIASES  optional, for reps who send invites from a different
 *                          address than they sign in with:
 *                            signin@gmail.com=work@company.com,other@company.com;
 *                            next@gmail.com=next@company.com
 *
 * Nothing is stored: the calendar is read fresh on each request, and moves
 * and cancellations made in the calendar show up on their own.
 */

// More than any one rep will have booked; keeps a runaway feed bounded.
const MAX_EVENTS = 100;
const GEOCODE_PARALLEL = 5;
const DEFAULT_LENGTH_MS = 60 * 60 * 1000; // an invite without an end time: assume an hour

/** Reps who send invites from an address other than the one they sign in with. */
export function parseAliases(raw) {
  const map = new Map();
  for (const entry of String(raw || '').split(/[;\n]+/)) {
    const [who, list] = entry.split('=');
    if (!who || !list) continue;
    const key = who.trim().toLowerCase();
    const extra = list
      .split(/[,\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    map.set(key, [...(map.get(key) || []), ...extra]);
  }
  return map;
}

/** "Site visit – Mr Tan" → "Mr Tan"; anything else is kept as written. */
export function clientName(summary) {
  const text = String(summary || '').trim();
  const rest = text.replace(/^site\s*visit\s*[-–—:|]?\s*/i, '').trim();
  return rest || text || 'Site visit';
}

const stableId = (e) =>
  'cal_' +
  crypto
    .createHash('sha1')
    .update(`${e.uid || e.summary || ''}|${e.recurrenceId || ''}|${e.start.epochMs}`)
    .digest('hex')
    .slice(0, 16);

/** An event's times in the shape the app's visits use. */
function visitTimes(e) {
  const startMs = e.start.epochMs;
  let endMs = e.end ? e.end.epochMs : startMs + (e.start.allDay ? 86_400_000 : DEFAULT_LENGTH_MS);
  if (endMs <= startMs) endMs = startMs + DEFAULT_LENGTH_MS;
  const s = sgDateTime(startMs);
  if (e.start.allDay) {
    return { date: s.date, start: '00:00', end: '23:59', endTs: endMs, allDay: true };
  }
  const f = sgDateTime(endMs);
  // A visit that runs past midnight is shown as ending at the end of its day.
  return { date: s.date, start: s.time, end: f.date === s.date ? f.time : '23:59', endTs: endMs };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Built as a factory so tests can supply their own sign-in check and clock;
 * the deployed endpoint (the default export) uses the real ones.
 */
export function makeInvitesHandler({ verify = verifyFirebaseToken, clock = () => Date.now() } = {}) {
  return async function handler(req, res) {
    // Every answer is one rep's own visits: never let a shared cache keep it.
    res.setHeader('Cache-Control', 'private, no-store');

    const feedUrl = String(process.env.PLANNER_ICAL_URL || '').trim();
    const plannerEmail = String(process.env.PLANNER_EMAIL || '').trim();
    if (!feedUrl) {
      return res.status(200).json({ enabled: false, plannerEmail: '', visits: [], unplaced: [] });
    }

    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) return res.status(401).json({ error: 'Sign in to see your calendar visits.' });

    let who;
    try {
      who = await verify(token, {
        projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
      });
    } catch (err) {
      return res.status(401).json({ error: err.message || 'Sign-in could not be checked.' });
    }
    if (!who.email || !who.emailVerified) {
      return res.status(403).json({ error: 'Your sign-in has no verified email address.' });
    }

    const aliases = parseAliases(process.env.PLANNER_EMAIL_ALIASES).get(who.email) || [];
    const mine = new Set([who.email, ...aliases]);

    let feed;
    try {
      const upstream = await fetch(feedUrl, { signal: AbortSignal.timeout(10_000) });
      if (!upstream.ok) {
        return res.status(502).json({
          error: `Couldn't read the planner calendar (HTTP ${upstream.status}). Check PLANNER_ICAL_URL.`,
        });
      }
      feed = await upstream.text();
    } catch (err) {
      return res.status(502).json({ error: `Couldn't reach the planner calendar: ${err.message}` });
    }

    const now = clock();
    const events = parseIcs(feed)
      .filter((e) => e.status !== 'CANCELLED')
      .filter((e) => e.organizer && mine.has(e.organizer))
      .map((e) => ({ e, t: visitTimes(e) }))
      .filter(({ t }) => t.endTs > now)
      .sort((a, b) => a.e.start.epochMs - b.e.start.epochMs)
      .slice(0, MAX_EVENTS);

    const placed = await mapLimit(events, GEOCODE_PARALLEL, async ({ e, t }) => {
      const base = { id: stableId(e), name: clientName(e.summary), ...t, fromCalendar: true };
      const location = String(e.location || '').trim();
      if (!location) return { unplaced: { ...base, location: '', reason: 'no-location' } };
      let hit = null;
      try {
        hit = await geocodeLocation(location);
      } catch {
        return { unplaced: { ...base, location, reason: 'lookup-failed' } };
      }
      if (!hit) return { unplaced: { ...base, location, reason: 'not-found' } };
      return {
        visit: {
          ...base,
          address: location.slice(0, 160),
          postal: /\b(\d{6})\b/.exec(location)?.[1] || hit.postal,
          lat: hit.lat,
          lng: hit.lng,
        },
      };
    });

    return res.status(200).json({
      enabled: true,
      plannerEmail,
      visits: placed.filter((p) => p.visit).map((p) => p.visit),
      unplaced: placed.filter((p) => p.unplaced).map((p) => p.unplaced),
    });
  };
}

export default makeInvitesHandler();
