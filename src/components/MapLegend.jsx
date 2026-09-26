import { colorHex, placeColor } from '../lib/places.js';

/**
 * Colour key for the custom pins, so a colour on the map can be named without
 * tapping it. Hidden entirely when there are no custom pins — with only site
 * visits on the map there is nothing to explain.
 */
export default function MapLegend({ places = [] }) {
  if (places.length === 0) return null;
  const shown = places.slice(0, 5);
  const extra = places.length - shown.length;
  return (
    <div className="legend">
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
