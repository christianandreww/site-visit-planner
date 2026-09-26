import { useEffect, useRef, useState } from 'react';

/**
 * Address input with live OneMap suggestions (via /api/search, debounced).
 * Calls onPick(place) when a suggestion is chosen, onPick(null) whenever the
 * text is edited afterwards (the coordinates are no longer trustworthy).
 */
export default function AddressSearch({ placeholder, initial, onPick, autoFocus }) {
  const [text, setText] = useState(initial ? initial.address : '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(''); // '' | 'loading' | 'none' | error text
  const skipFetchRef = useRef(Boolean(initial));
  const abortRef = useRef(null);
  const dropRef = useRef(null);

  useEffect(() => {
    if (skipFetchRef.current) {
      skipFetchRef.current = false;
      return undefined;
    }
    const q = text.trim();
    if (q.length < 3) {
      setResults([]);
      setOpen(false);
      setStatus('');
      return undefined;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStatus('loading');
      setOpen(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Search failed.');
        setResults(data.results || []);
        setStatus(data.results && data.results.length ? '' : 'none');
      } catch (e) {
        if (e.name === 'AbortError') return;
        setResults([]);
        setStatus(e.message || 'Search failed.');
      }
    }, 300);
    return () => clearTimeout(t);
  }, [text]);

  // The form sheet scrolls, so a dropdown opening near its bottom edge gets
  // clipped. Nudge it into view — 'nearest' scrolls the minimum needed and
  // does nothing when the list is already fully visible.
  useEffect(() => {
    if (!open || !dropRef.current) return;
    dropRef.current.scrollIntoView({ block: 'nearest' });
  }, [open, results.length, status]);

  function pick(r) {
    skipFetchRef.current = true;
    setText(r.address || r.label);
    setResults([]);
    setOpen(false);
    setStatus('');
    onPick(r);
  }

  return (
    <div className="addr">
      <input
        className="input"
        placeholder={placeholder}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => {
          setText(e.target.value);
          onPick(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (results.length) pick(results[0]);
          }
        }}
      />
      {open && (
        <div className="addr-drop" ref={dropRef}>
          {status === 'loading' && <div className="addr-note">Searching…</div>}
          {status === 'none' && (
            <div className="addr-note">No matches — try the postal code instead.</div>
          )}
          {status && status !== 'loading' && status !== 'none' && (
            <div className="addr-note addr-err">{status}</div>
          )}
          {results.map((r, i) => (
            <button type="button" key={i} className="addr-row" onClick={() => pick(r)}>
              <span className="addr-main">{r.label}</span>
              <span className="addr-sub">
                {r.address}
                {r.postal ? ` · S${r.postal}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
