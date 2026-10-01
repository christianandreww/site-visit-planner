import { useMemo, useState } from 'react';
import { fmtTime, pinLabel } from '../lib/time.js';
import { colorHex, placeColor } from '../lib/places.js';

/**
 * Search across upcoming visits by client name, address, or postal code.
 * Runs entirely on-device (no API calls). With the box empty it lists the
 * whole upcoming schedule in time order — a handy list view of the map.
 */
export default function SearchPanel({ visits, places = [], onPick, onPickPlace, onClose }) {
  const [q, setQ] = useState('');

  const needle = q.trim().toLowerCase();
  const matches = (item) =>
    !needle ||
    [item.name, item.address, item.postal].some(
      (field) => field && String(field).toLowerCase().includes(needle)
    );

  const results = useMemo(() => visits.filter(matches), [q, visits]);
  const placeResults = useMemo(() => places.filter(matches), [q, places]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="sheet sheet-search" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="input"
          placeholder="Search client, address, or postal code…"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && results.length) onPick(results[0].id);
          }}
        />
        <div className="search-list">
          {results.length === 0 && placeResults.length === 0 && (
            <div className="search-empty">
              {visits.length === 0 && places.length === 0
                ? 'Nothing on the map yet.'
                : 'No matches among your visits or pins.'}
            </div>
          )}
          {results.map((v) => (
            <button key={v.id} className="search-row" onClick={() => onPick(v.id)}>
              <span className="search-seq">{visits.indexOf(v) + 1}</span>
              <span className="search-when">
                {pinLabel(v.date)} {fmtTime(v.date, v.start)}
              </span>
              <span className="search-body">
                <strong>{v.name}</strong>
                <span>
                  {v.address}
                  {v.postal && !String(v.address || '').includes(v.postal) ? ` · S${v.postal}` : ''}
                </span>
              </span>
            </button>
          ))}
          {placeResults.length > 0 && (
            <div className="search-heading">Custom pins</div>
          )}
          {placeResults.map((p) => (
            <button
              key={p.id}
              className="search-row"
              onClick={() => onPickPlace(p.id)}
            >
              <i
                className="search-dot"
                style={{ background: colorHex(placeColor(p)) }}
              />
              <span className="search-when">Pin</span>
              <span className="search-body">
                <strong>{p.name}</strong>
                <span>
                  {p.address}
                  {p.postal ? ` · S${p.postal}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
