import { useState } from 'react';
import AddressSearch from './AddressSearch.jsx';
import { PIN_COLORS, PLACE_PRESETS, DEFAULT_COLOR, colorHex } from '../lib/places.js';

/**
 * Add or edit a custom pin — a permanent place on the map. No date, no times:
 * that is the whole point of it.
 */
export default function PlaceForm({
  prefill,
  editing = false,
  onCancel,
  // Tapping the dimmed area behind the sheet. Normally that abandons the form,
  // but while another card is open on top of it, it should only close that —
  // throwing away half-typed details is the thing to avoid.
  onDismiss = null,
  onSave,
}) {
  const [name, setName] = useState(prefill?.name || '');
  const [color, setColor] = useState(prefill?.color || DEFAULT_COLOR);
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
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const valid = name.trim() && place;

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
        color,
      });
    } catch (e2) {
      setErr(e2.message || 'Could not save the pin.');
      setSaving(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={onDismiss || onCancel}>
      <form className="sheet" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{editing ? 'Edit pin' : 'Add a custom pin'}</h2>
        <div className="hint">
          A permanent marker on your map — it has no date or time and stays until
          you remove it.
        </div>

        <label className="field">
          Name
          <input
            className="input"
            value={name}
            placeholder="e.g. Home, School, Main office"
            maxLength={30}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="chips">
          {PLACE_PRESETS.map((p) => (
            <button
              type="button"
              key={p.name}
              className={name === p.name && color === p.color ? 'chip chip-on' : 'chip'}
              onClick={() => {
                setName(p.name);
                setColor(p.color);
              }}
            >
              <i className="chip-dot" style={{ background: colorHex(p.color) }} />
              {p.name}
            </button>
          ))}
        </div>

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

        <div className="field">Pin colour</div>
        <div className="swatches">
          {PIN_COLORS.map((c) => (
            <button
              type="button"
              key={c.key}
              title={c.name}
              aria-label={c.name}
              className={color === c.key ? 'swatch swatch-on' : 'swatch'}
              style={{ background: c.hex }}
              onClick={() => setColor(c.key)}
            />
          ))}
        </div>
        <div className="hint">
          Blue and orange aren’t offered — they belong to site visits and the
          new-client pin.
        </div>

        {err && <div className="hint hint-err">{err}</div>}

        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valid || saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Save pin'}
          </button>
        </div>
      </form>
    </div>
  );
}
