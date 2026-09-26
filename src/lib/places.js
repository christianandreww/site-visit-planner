// Custom pins ("places") are permanent map markers — home, school, the office,
// a supplier's yard. They carry no date or time and never expire; they sit on
// the map as fixed reference points while site visits come and go.
//
// Blue is reserved for scheduled site visits and orange for the new-client pin,
// so neither is offered here — a custom pin must never be mistaken for either.

export const PIN_COLORS = [
  { key: 'green', hex: '#15803d', name: 'Green' },
  { key: 'violet', hex: '#7c3aed', name: 'Violet' },
  { key: 'teal', hex: '#0f766e', name: 'Teal' },
  { key: 'pink', hex: '#be185d', name: 'Pink' },
  { key: 'amber', hex: '#b45309', name: 'Amber' },
  { key: 'slate', hex: '#475569', name: 'Slate' },
  { key: 'red', hex: '#b91c1c', name: 'Red' },
  { key: 'brown', hex: '#78350f', name: 'Brown' },
];

export const DEFAULT_COLOR = 'green';

// One-tap starting points. The name stays editable after picking one.
export const PLACE_PRESETS = [
  { name: 'Home', color: 'green' },
  { name: 'School', color: 'violet' },
  { name: 'Office', color: 'teal' },
  { name: 'Warehouse', color: 'amber' },
];

/** Hex for a palette key, falling back to the default. */
export function colorHex(key) {
  const found = PIN_COLORS.find((c) => c.key === key);
  return (found || PIN_COLORS[0]).hex;
}

export function placeColor(p) {
  return (p && p.color) || DEFAULT_COLOR;
}

/** The letter shown inside a custom pin — its name's first character. */
export function placeInitial(p) {
  const n = (p && p.name ? String(p.name).trim() : '');
  return n ? n[0].toUpperCase() : '•';
}
