import { colorHex, placeColor } from '../lib/places.js';
import { URGENCY } from '../lib/time.js';

/**
 * Colour key for the map: how soon a visit is (its shade of blue), and the
 * custom pins' colours, so a colour on the map can be named without tapping
 * it. Each half shows only when there is something on the map for it to
 * explain.
 */
export default function MapLegend({ places = [], hasVisits = false }) {
  if (places.length === 0 && !hasVisits) return null;
  const shown = places.slice(0, 5);
  const extra = places.length - shown.length;
  return (
    <div className="legend">
      {hasVisits &&
        URGENCY.map((t) => (
          <span className="legend-item" key={t.key}>
            <i className={`legend-dot legend-${t.key}`} />
            {t.label}
          </span>
        ))}
      {hasVisits && places.length > 0 && <span className="legend-break" aria-hidden="true" />}
      {shown.map((p) => (
        <span className="legend-item" key={p.id}>
          <i className="legend-dot" style={{ background: colorHex(placeColor(p)) }} />
          {p.name}
        </span>
      ))}
      {extra > 0 && <span className="legend-item muted">+{extra} more</span>}
    </div>
  );
}
