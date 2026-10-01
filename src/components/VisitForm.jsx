import { useMemo, useState } from 'react';
import AddressSearch from './AddressSearch.jsx';
import {
  todayISO,
  addMinutes,
  endTimestamp,
  startTimestamp,
  rangesOverlap,
  fmtRange,
  fmtTime,
} from '../lib/time.js';
import { useRoute, driveUrl, transitAt } from '../lib/routes.js';
import NearbyVisits from './NearbyVisits.jsx';

/**
 * Advisory warning when the gap to a neighbouring visit is shorter than the
 * real driving time between the two addresses. Never blocks saving.
 *
 * The trigger stays on driving — the faster mode, so the warning stays
 * conservative — but the public-transport time is shown alongside it, since a
 * gap that is merely tight by car may be impossible by bus.
 */
function TightTravel({ from, to, gapMins, label, date, time }) {
  const drive = useRoute(driveUrl(from, to));
  const transit = useRoute(transitAt(from, to, date, time));
  if (drive.kind !== 'ok' || drive.mins <= gapMins) return null;
  return (
    <div className="hint hint-warn">
      ⚠ {label} — only a {gapMins} min gap, but it’s ~{drive.mins} min by car
      {transit.kind === 'ok' ? ` · ~${transit.mins} min by public transport` : ''}.
      You can still save.
    </div>
  );
}

export default function VisitForm({
  prefill,
  visits = [],
  editing = false,
  excludeId = null,
  onOpenVisit = null,
  onCancel,
  // Tapping the dimmed area behind the sheet. Normally that abandons the
  // form, but while a visit is being consulted on top of it, it should only
  // close that — abandoning half-typed details is the thing to avoid.
  onDismiss = null,
  // The planner's own address, once calendar invites are switched on.
  plannerEmail = '',
  onSave,
}) {
  const [name, setName] = useState(prefill?.name || '');
  const [place, setPlace] = useState(
    prefill && Number.isFinite(prefill.lat)
      ? {
          label: prefill.address,
          address: prefill.address,
          postal: prefill.postal || '',
          lat: prefill.lat,
          lng: prefill.lng,
        }
      : null
  );
  const [date, setDate] = useState(prefill?.date || todayISO());
  const [start, setStart] = useState(prefill?.start || '10:00');
  const [end, setEnd] = useState(prefill?.end || '11:00');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function handleStartChange(v) {
    setStart(v);
    if (v && end <= v) setEnd(addMinutes(v, 60));
  }

  const timesOk = start && end && end > start;
  const valid = name.trim() && place && date && timesOk;

  // ── clash checks (advisory only — saving is never blocked) ──────────────
  const proposed = useMemo(() => {
    if (!date || !timesOk) return null;
    return { s: startTimestamp(date, start), e: endTimestamp(date, end) };
  }, [date, start, end, timesOk]);

  const overlaps = useMemo(() => {
    if (!proposed) return [];
    return visits.filter(
      (v) =>
        v.id !== excludeId &&
        v.date === date &&
        rangesOverlap(proposed.s, proposed.e, startTimestamp(v.date, v.start), v.endTs)
    );
  }, [visits, proposed, date, excludeId]);

  const neighbors = useMemo(() => {
    if (!proposed) return { prev: null, next: null };
    let prev = null;
    let next = null;
    for (const v of visits) {
      if (v.id === excludeId || v.date !== date || overlaps.includes(v)) continue;
      if (v.endTs <= proposed.s && (!prev || v.endTs > prev.endTs)) prev = v;
      const vs = startTimestamp(v.date, v.start);
      if (vs >= proposed.e && (!next || vs < startTimestamp(next.date, next.start))) {
        next = v;
      }
    }
    return { prev, next };
  }, [visits, proposed, date, overlaps, excludeId]);

  const gapPrev = neighbors.prev
    ? Math.round((proposed.s - neighbors.prev.endTs) / 60000)
    : null;
  const gapNext = neighbors.next
    ? Math.round(
        (startTimestamp(neighbors.next.date, neighbors.next.start) - proposed.e) / 60000
      )
    : null;

  async function submit(e) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setErr('');
    try {
      await onSave({
        name: name.trim(),
        address: place.address,
        postal: place.postal || '',
        lat: place.lat,
        lng: place.lng,
        date,
        start,
        end,
        endTs: endTimestamp(date, end),
      });
    } catch (e2) {
      setErr(e2.message || 'Could not save the visit.');
      setSaving(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={onDismiss || onCancel}>
      <form className="sheet" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{editing ? 'Edit site visit' : 'Add site visit'}</h2>
        {plannerEmail && (
          <p className="hint hint-invite">
            Or skip this form: add <strong>{plannerEmail}</strong> as a guest on the calendar
            event, with the postal code in its title or Location, and the visit appears on the
            map by itself.
          </p>
        )}

        <label className="field">
          Client name
          <input
            className="input"
            value={name}
            placeholder="e.g. John Tan"
            autoFocus={!prefill}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="field">
          Address
          <AddressSearch
            placeholder="Address or postal code…"
            initial={place}
            onPick={setPlace}
          />
        </label>
        <div className={place ? 'hint hint-ok' : 'hint'}>
          {place
            ? 'Location pinned ✓'
            : 'Pick an address from the suggestions to pin it on the map.'}
        </div>

        {/* Geography before dates: as soon as the address is pinned, show what
            is already scheduled nearby, so the slot can be chosen knowing it. */}
        {place && (
          <NearbyVisits
            from={place}
            visits={visits}
            excludeId={excludeId}
            title="Nearest upcoming visits"
            emptyText="Nothing else scheduled nearby yet."
            onOpenVisit={onOpenVisit}
          />
        )}

        <div className="row3">
          <label className="field">
            Date
            <input
              className="input"
              type="date"
              value={date}
              min={todayISO()}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="field">
            Start
            <input
              className="input"
              type="time"
              step="900"
              value={start}
              onChange={(e) => handleStartChange(e.target.value)}
            />
          </label>
          <label className="field">
            End
            <input
              className="input"
              type="time"
              step="900"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>

        {start && end && !timesOk && (
          <div className="hint hint-err">End time must be after the start time.</div>
        )}

        {overlaps.length > 0 && (
          <div className="hint hint-warn">
            ⚠ Overlaps with {overlaps[0].name} ({fmtRange(overlaps[0])})
            {overlaps.length > 1 ? ` and ${overlaps.length - 1} more` : ''}. You can
            still save.
          </div>
        )}
        {proposed && place && neighbors.prev && gapPrev <= 90 && (
          <TightTravel
            from={neighbors.prev}
            to={place}
            gapMins={gapPrev}
            date={date}
            time={neighbors.prev.end}
            label={`Tight after ${neighbors.prev.name} (ends ${fmtTime(neighbors.prev.date, neighbors.prev.end)})`}
          />
        )}
        {proposed && place && neighbors.next && gapNext <= 90 && (
          <TightTravel
            from={place}
            to={neighbors.next}
            gapMins={gapNext}
            date={date}
            time={end}
            label={`Tight before ${neighbors.next.name} (starts ${fmtTime(neighbors.next.date, neighbors.next.start)})`}
          />
        )}

        {err && <div className="hint hint-err">{err}</div>}

        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valid || saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Save visit'}
          </button>
        </div>
      </form>
    </div>
  );
}
