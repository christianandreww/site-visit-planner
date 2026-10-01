import { fmtDate, fmtRange, fmtTime, weekdayShort } from '../lib/time.js';
import { haversineKm, fmtKm } from '../lib/geo.js';
import { useRoute, driveUrl, transitUrl } from '../lib/routes.js';
import NearbyVisits from './NearbyVisits.jsx';
import NearbyPlaces from './NearbyPlaces.jsx';

function DriveTime({ from, to }) {
  const state = useRoute(driveUrl(from, to));
  if (state.kind === 'loading')
    return <div className="card-drive card-drive-muted">Calculating drive time…</div>;
  if (state.kind === 'err')
    return <div className="card-drive card-drive-muted">Drive time unavailable</div>;
  return (
    <div className="card-drive">
      🚗 ~{state.mins} min drive · {state.km} km by road
    </div>
  );
}

// Public transport, timed so that you arrive for the appointment rather than
// set off at its start time. The second line is where the minutes go: a
// 45-minute journey that is half waiting is worth knowing about before you
// commit to it. (The leg-by-leg detail — bus numbers, alighting stops — is
// fetched too, and deliberately kept out of the card for simplicity.)
function TransitTime({ from, visit }) {
  const state = useRoute(transitUrl(from, visit));
  if (state.kind === 'loading')
    return <div className="card-drive card-drive-muted">Checking public transport…</div>;
  if (state.kind === 'err')
    return <div className="card-drive card-drive-muted">No public transport route found</div>;

  const detail = [
    state.walkMins ? `${state.walkMins} min walking` : null,
    state.waitMins ? `${state.waitMins} min waiting` : null,
    state.transfers
      ? `${state.transfers} transfer${state.transfers > 1 ? 's' : ''}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const leaveBy =
    state.arrivesInTime && state.departAt
      ? fmtTime(state.plannedFor || visit.date, state.departAt)
      : null;

  return (
    <div className="card-transit">
      <div className="card-drive">🚌 ~{state.mins} min by public transport</div>
      {(leaveBy || detail) && (
        <div className="pt-sub">
          {leaveBy ? <strong>Leave by {leaveBy}</strong> : null}
          {leaveBy && detail ? ' · ' : ''}
          {detail}
        </div>
      )}
      {state.approx && (
        <div className="pt-sub pt-approx">
          Typical for a {weekdayShort(state.plannedFor)} — timetables aren’t published
          this far ahead.
        </div>
      )}
    </div>
  );
}

/**
 * The bottom card that opens when a pin is tapped — sized to be read at a
 * glance while on the phone with a client.
 */
export default function VisitPopup({
  visit,
  prospect,
  currentClient,
  visits,
  places = [],
  onClose,
  onBack = null,
  readOnly = false,
  className = '',
  onRemove,
  onOpenVisit,
  onOpenPlace,
  onEdit,
  onSaveProspect,
}) {
  if (!visit && !prospect) return null;

  // Shown whenever you arrived here from another card, so a detour into a
  // neighbouring visit is always reversible.
  const back = onBack ? (
    <button className="card-back" onClick={onBack}>
      ‹ Back
    </button>
  ) : null;

  // ── card for an existing site visit ─────────────────────────────────────
  if (visit) {
    return (
      <div className={`card ${className}`.trim()}>
        {back}
        <button className="card-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div className="card-kicker">
          {fmtDate(visit.date)}
          <span className="card-seq">
            #{visits.indexOf(visit) + 1} of {visits.length}
          </span>
          {visit.fromCalendar && <span className="card-tag card-tag-cal">From calendar</span>}
        </div>
        <h3 className="card-name">{visit.name}</h3>
        <div className="card-addr">
          {visit.address}
          {/* a calendar Location usually ends with the postal code already */}
          {visit.postal && !String(visit.address || '').includes(visit.postal)
            ? ` · S${visit.postal}`
            : ''}
        </div>
        <div className="card-time">🕑 {fmtRange(visit)}</div>

        {currentClient && (
          <div className="card-dist">
            <div>
              📍 {fmtKm(haversineKm(visit, currentClient))} from{' '}
              <strong>{currentClient.name}</strong>{' '}
              <span className="muted">(straight line)</span>
            </div>
            <DriveTime from={currentClient} to={visit} />
            <TransitTime from={currentClient} visit={visit} />
          </div>
        )}

        <NearbyVisits
          from={visit}
          visits={visits}
          excludeId={visit.id}
          title="Other visits nearby"
          onOpenVisit={onOpenVisit}
        />

        {/* leaving this visit as it ends is the journey that matters */}
        <NearbyPlaces
          from={visit}
          places={places}
          when={{ date: visit.date, time: visit.end }}
          onOpenPlace={onOpenPlace}
        />

        {/* While this card is only being consulted from inside the add form,
            editing or removing would throw away what is being typed. */}
        {visit.fromCalendar && (
          <p className="card-note">
            This visit comes from your calendar. To change or cancel it, edit the event
            there and the map will follow.
          </p>
        )}
        {!readOnly && !visit.fromCalendar && (
          <div className="card-actions">
            <button
              className="btn btn-danger-text btn-sm"
              onClick={() => {
                if (window.confirm(`Remove ${visit.name}'s site visit?`)) {
                  onRemove(visit.id);
                }
              }}
            >
              Remove
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => onEdit(visit)}>
              Edit visit
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── card for the new client being scheduled ─────────────────────────────
  return (
    <div className={`card card-prospect ${className}`.trim()}>
      {back}
      <button className="card-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      <div className="card-kicker card-kicker-new">New client · not saved yet</div>
      <h3 className="card-name">{prospect.name}</h3>
      <div className="card-addr">
        {prospect.address}
        {prospect.postal ? ` · S${prospect.postal}` : ''}
      </div>

      <NearbyVisits
        from={prospect}
        visits={visits}
        title="Nearest upcoming visits"
        onOpenVisit={onOpenVisit}
        emptyText="No upcoming visits on the map yet."
      />

      <NearbyPlaces from={prospect} places={places} onOpenPlace={onOpenPlace} />

      <div className="card-actions">
        <button className="btn btn-primary" onClick={onSaveProspect}>
          Save as site visit
        </button>
      </div>
    </div>
  );
}
