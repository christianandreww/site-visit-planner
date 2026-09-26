import { useMemo } from 'react';
import { fmtTime, pinLabel } from '../lib/time.js';
import { haversineKm, fmtKm } from '../lib/geo.js';
import { DriveMins, TransitMins } from './TravelTimes.jsx';

/**
 * The nearest upcoming site visits to any point on the map — a saved visit, a
 * custom pin, a client mid-call, or an address just pinned in the add form.
 * Ranked by straight-line distance (instant, on-device), with real driving and
 * public-transport times loaded per row.
 *
 * Rows are tappable when `onOpenVisit` is given. Inside the add-visit form the
 * tapped visit opens over the form rather than in place of it, so a quick look
 * at a neighbour never costs you what you had already typed.
 */
export default function NearbyVisits({
  from,
  visits,
  title = 'Other visits nearby',
  excludeId = null,
  limit = 3,
  onOpenVisit = null,
  emptyText = null,
}) {
  const nearest = useMemo(() => {
    if (!from || !Number.isFinite(from.lat)) return [];
    return visits
      .filter((v) => v.id !== excludeId)
      .map((v) => ({ v, km: haversineKm(v, from) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, limit);
  }, [from, visits, excludeId, limit]);

  if (nearest.length === 0) {
    return emptyText ? <div className="near-none">{emptyText}</div> : null;
  }

  return (
    <div className="near">
      <div className="near-title">{title}</div>
      {nearest.map(({ v, km }) => {
        const body = (
          <>
            <span className="near-when">
              {pinLabel(v.date)} {fmtTime(v.date, v.start)}
            </span>
            <span className="near-name">{v.name}</span>
            <span className="near-metrics">
              <span className="near-times">
                <DriveMins from={from} to={v} />
                {/* the journey that matters is the one that gets you there
                    in time for the appointment, not one that leaves as it
                    starts — so the time is a deadline, not a departure */}
                <TransitMins from={from} to={v} date={v.date} time={v.start} by="arrive" />
              </span>
              <span className="near-dist">{fmtKm(km)}</span>
            </span>
          </>
        );
        return onOpenVisit ? (
          <button key={v.id} className="near-row" onClick={() => onOpenVisit(v.id)}>
            {body}
          </button>
        ) : (
          <div key={v.id} className="near-row near-row-static">
            {body}
          </div>
        );
      })}
    </div>
  );
}
