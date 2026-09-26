import { useEffect, useState } from 'react';

// Route lookups between two fixed points are stable — cache them per session,
// shared by every component that shows a travel time (cards, nearby rows,
// and the clash warnings in the add-visit form).
const routeCache = new Map();

export function fetchRoute(url) {
  if (routeCache.has(url)) return routeCache.get(url);
  const p = (async () => {
    const r = await fetch(url);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'No route available.');
    return data;
  })();
  routeCache.set(url, p);
  p.catch(() => routeCache.delete(url));
  return p;
}

export const coordsQS = (from, to) =>
  `start=${from.lat},${from.lng}&end=${to.lat},${to.lng}`;

/** Driving route between two {lat,lng} points. Returns { km, mins }. */
export const driveUrl = (from, to) => `/api/route?${coordsQS(from, to)}`;

/**
 * Public-transport route between two points at a given date and time —
 * schedules matter, so the answer is only meaningful with one.
 *
 * `by` says which end of the journey that time pins: 'depart' (you set off
 * then) or 'arrive' (you have to be there by then). For a bus or train the
 * difference is the whole answer.
 */
export const transitAt = (from, to, dateISO, timeHM, by = 'depart') =>
  `/api/route?${coordsQS(from, to)}&mode=pt&date=${dateISO}&time=${timeHM}&by=${by}`;

/** Transit to a visit: you need to be there when it starts, not leave then. */
export const transitUrl = (from, v) => transitAt(from, v, v.date, v.start, 'arrive');

/** React hook: { kind: 'loading' | 'ok' | 'err', ...data } for a route URL. */
export function useRoute(url) {
  const [state, setState] = useState({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    setState({ kind: 'loading' });
    fetchRoute(url).then(
      (d) => alive && setState({ kind: 'ok', ...d }),
      () => alive && setState({ kind: 'err' })
    );
    return () => {
      alive = false;
    };
  }, [url]);
  return state;
}
