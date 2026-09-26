import { useRoute, driveUrl, transitAt } from '../lib/routes.js';
import { transitNote } from '../lib/transit.js';

/** Driving time for a compact list row. */
export function DriveMins({ from, to }) {
  const state = useRoute(driveUrl(from, to));
  if (state.kind === 'loading') return <span className="near-wait">🚗 …</span>;
  if (state.kind === 'err') {
    return (
      <span className="near-wait" title="No driving route found.">
        🚗 —
      </span>
    );
  }
  return <span>🚗 ~{state.mins} min</span>;
}

/**
 * Public-transport time for a compact list row, timed to the moment the
 * journey happens. A dash means there genuinely is no bus or train route —
 * which is worth showing, since silence looks like the app is still thinking.
 */
export function TransitMins({ from, to, date, time, by = 'depart' }) {
  const state = useRoute(transitAt(from, to, date, time, by));
  if (state.kind === 'loading') return <span className="near-wait">🚌 …</span>;
  if (state.kind === 'err') {
    return (
      <span className="near-wait" title="No bus or train route between these two points.">
        🚌 —
      </span>
    );
  }
  return (
    <span title={transitNote(state)}>
      🚌 ~{state.mins} min
      {state.approx ? <span className="near-approx">*</span> : null}
    </span>
  );
}
