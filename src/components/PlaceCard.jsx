import { colorHex, placeColor } from '../lib/places.js';
import { haversineKm, fmtKm } from '../lib/geo.js';
import NearbyVisits from './NearbyVisits.jsx';

/** The bottom card for a custom pin. No schedule — just where it is. */
export default function PlaceCard({
  place,
  visits = [],
  currentClient,
  onClose,
  onBack = null,
  readOnly = false,
  className = '',
  onEdit,
  onRemove,
  onOpenVisit,
}) {
  if (!place) return null;
  const hex = colorHex(placeColor(place));
  return (
    <div className={`card ${className}`.trim()}>
      {onBack && (
        <button className="card-back" onClick={onBack}>
          ‹ Back
        </button>
      )}
      <button className="card-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      <div className="card-kicker" style={{ color: hex }}>
        Custom pin
        <span className="card-tag" style={{ background: hex }}>
          Always on the map
        </span>
      </div>
      <h3 className="card-name">{place.name}</h3>
      <div className="card-addr">
        {place.address}
        {place.postal ? ` · S${place.postal}` : ''}
      </div>

      {currentClient && (
        <div className="card-dist">
          <div>
            📍 {fmtKm(haversineKm(place, currentClient))} from{' '}
            <strong>{currentClient.name}</strong>{' '}
            <span className="muted">(straight line)</span>
          </div>
        </div>
      )}

      <NearbyVisits
        from={place}
        visits={visits}
        title="Site visits nearby"
        onOpenVisit={onOpenVisit}
        emptyText="No upcoming visits near this pin."
      />

      {!readOnly && (
        <div className="card-actions">
          <button
            className="btn btn-danger-text btn-sm"
            onClick={() => {
              if (window.confirm(`Remove the “${place.name}” pin?`)) onRemove(place.id);
            }}
          >
            Remove
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => onEdit(place)}>
            Edit pin
          </button>
        </div>
      )}
    </div>
  );
}
