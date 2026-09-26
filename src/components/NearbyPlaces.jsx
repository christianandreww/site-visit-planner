import { useMemo } from 'react';
import { haversineKm, fmtKm } from '../lib/geo.js';
import { colorHex, placeColor } from '../lib/places.js';
import { DriveMins, TransitMins } from './TravelTimes.jsx';
import { nowSG } from '../lib/time.js';

/**
 * How far this point is from the fixed places you've pinned — home, school,
 * the office — by road and by public transport.
 *
 * A custom pin has no scheduled time of its own, so transit needs a departure
 * moment: `when` if the caller has one (leaving a visit as it ends), otherwise
 * now, rounded to the quarter hour so the answer stays cacheable.
 */
export default function NearbyPlaces({
  from,
  places = [],
  when = null,
  limit = 4,
  title = 'From your pins',
  onOpenPlace = null,
}) {
  const fallbackWhen = useMemo(() => nowSG(), []);
  const departAt = when || fallbackWhen;
  const nearest = useMemo(() => {
    if (!from || !Number.isFinite(from.lat)) return [];
    return places
      .map((p) => ({ p, km: haversineKm(p, from) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, limit);
  }, [from, places, limit]);

  if (nearest.length === 0) return null;

  return (
    <div className="near">
      <div className="near-title">{title}</div>
      {nearest.map(({ p, km }) => {
        const body = (
          <>
            <i className="near-dot" style={{ background: colorHex(placeColor(p)) }} />
            <span className="near-name">{p.name}</span>
            <span className="near-metrics">
              <span className="near-times">
                <DriveMins from={from} to={p} />
                <TransitMins from={from} to={p} date={departAt.date} time={departAt.time} />
              </span>
              <span className="near-dist">{fmtKm(km)}</span>
            </span>
          </>
        );
        return onOpenPlace ? (
          <button key={p.id} className="near-row" onClick={() => onOpenPlace(p.id)}>
            {body}
          </button>
        ) : (
          <div key={p.id} className="near-row near-row-static">
            {body}
          </div>
        );
      })}
    </div>
  );
}
