import test from 'node:test';
import assert from 'node:assert/strict';
import {
  endTimestamp,
  startTimestamp,
  rangesOverlap,
  addMinutes,
  todayISO,
  fmtTime,
  fmtDate,
  weekdayShort,
  daysUntil,
  pinLabel,
  urgencyTier,
  URGENCY,
} from '../src/lib/time.js';
import { readFileSync } from 'node:fs';
import { haversineKm, fmtKm } from '../src/lib/geo.js';
import { sampleVisits, sampleProspect } from '../src/lib/demo.js';
import { samplePlaces } from '../src/lib/demo.js';
import {
  PIN_COLORS,
  PLACE_PRESETS,
  colorHex,
  placeColor,
  placeInitial,
} from '../src/lib/places.js';

test('endTimestamp pins to Singapore time regardless of device timezone', () => {
  // 21 Aug 2026, 2:00 PM SGT == 6:00 AM UTC
  assert.equal(endTimestamp('2026-08-21', '14:00'), Date.UTC(2026, 7, 21, 6, 0, 0));
});

test('startTimestamp pins to Singapore time', () => {
  // 21 Aug 2026, 2:00 PM SGT == 6:00 AM UTC
  assert.equal(startTimestamp('2026-08-21', '14:00'), Date.UTC(2026, 7, 21, 6, 0, 0));
});

test('rangesOverlap detects clashes and respects boundaries', () => {
  const h = (x) => Date.UTC(2026, 7, 24, x);
  assert.ok(rangesOverlap(h(2), h(4), h(3), h(5)), 'partial overlap');
  assert.ok(rangesOverlap(h(3), h(5), h(2), h(4)), 'partial overlap, reversed');
  assert.ok(rangesOverlap(h(1), h(6), h(2), h(3)), 'containment');
  assert.ok(!rangesOverlap(h(2), h(3), h(3), h(4)), 'back-to-back is not a clash');
  assert.ok(!rangesOverlap(h(1), h(2), h(3), h(4)), 'disjoint');
});

test('addMinutes adds and clamps within the day', () => {
  assert.equal(addMinutes('14:30', 60), '15:30');
  assert.equal(addMinutes('09:05', 90), '10:35');
  assert.equal(addMinutes('23:30', 60), '23:59');
});

test('todayISO returns YYYY-MM-DD', () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(todayISO(3), todayISO());
});

test('time formatting', () => {
  assert.equal(fmtTime('2026-08-21', '14:00'), '2:00 PM');
  assert.equal(fmtTime('2026-08-21', '09:30'), '9:30 AM');
  assert.match(fmtDate('2026-08-18'), /Tue.*18.*Aug/);
  assert.equal(weekdayShort('2026-08-24'), 'Mon');
});

test('haversine gives sane Singapore distances', () => {
  const woodlands = { lat: 1.4443, lng: 103.802 };
  const elias = { lat: 1.3736, lng: 103.944 };
  const km = haversineKm(woodlands, elias);
  assert.ok(km > 16 && km < 19, `expected ~17.6km, got ${km}`);
  assert.ok(haversineKm(elias, elias) < 0.001);
});

test('fmtKm formatting', () => {
  assert.equal(fmtKm(3.234), '3.2 km');
  assert.equal(fmtKm(12.7), '13 km');
});

test('demo data is always upcoming and complete', () => {
  const visits = sampleVisits();
  assert.equal(visits.length, 5);
  for (const v of visits) {
    assert.ok(v.endTs > Date.now(), `${v.name} should be upcoming`);
    for (const k of ['id', 'name', 'address', 'lat', 'lng', 'date', 'start', 'end']) {
      assert.ok(v[k], `${v.name} missing ${k}`);
    }
    // a visit's shade of blue comes from its date; colour belongs to custom pins
    assert.equal(v.catColor, undefined, 'visits carry no colour of their own');
  }
  const p = sampleProspect();
  assert.ok(p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng));
});


// ── custom pins (permanent places) ────────────────────────────────────────

test('the custom-pin palette never offers blue or orange', () => {
  // blue belongs to scheduled site visits, orange to the new-client pin —
  // a custom pin must never be mistaken for either
  const hexes = PIN_COLORS.map((c) => c.hex.toLowerCase());
  assert.ok(!hexes.includes('#1d4ed8'), 'visit blue must not be selectable');
  assert.ok(!hexes.includes('#f97316'), 'prospect orange must not be selectable');
  assert.ok(PIN_COLORS.length >= 6, 'still plenty of choice');
  const keys = PIN_COLORS.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length, 'colour keys are unique');
});

test('every preset uses a colour from the palette', () => {
  for (const preset of PLACE_PRESETS) {
    assert.ok(
      PIN_COLORS.some((c) => c.key === preset.color),
      `${preset.name} uses an unknown colour: ${preset.color}`
    );
  }
});

test('colorHex resolves keys and falls back safely', () => {
  assert.match(colorHex('violet'), /^#[0-9a-f]{6}$/i);
  assert.equal(colorHex('no-such-colour'), PIN_COLORS[0].hex);
});

test('placeColor falls back when a pin has no colour stored', () => {
  assert.equal(placeColor({ name: 'Home', color: 'teal' }), 'teal');
  assert.match(colorHex(placeColor({ name: 'Nameless' })), /^#[0-9a-f]{6}$/i);
});

test('placeInitial gives each pin its letter', () => {
  assert.equal(placeInitial({ name: 'Home' }), 'H');
  assert.equal(placeInitial({ name: 'school' }), 'S');
  assert.equal(placeInitial({ name: '  warehouse' }), 'W');
  assert.equal(placeInitial({ name: '' }), '\u2022');
  assert.equal(placeInitial(undefined), '\u2022');
});

test('custom pins carry no schedule at all', () => {
  const places = samplePlaces();
  assert.ok(places.length > 0);
  for (const p of places) {
    for (const k of ['id', 'name', 'address', 'lat', 'lng', 'color']) {
      assert.ok(p[k], `${p.name} missing ${k}`);
    }
    // the whole point: nothing time-based, so nothing can ever expire
    for (const k of ['date', 'start', 'end', 'endTs']) {
      assert.equal(p[k], undefined, `${p.name} must not carry ${k}`);
    }
  }
});


// ── pin labels: weekday only while it is unambiguous ──────────────────────

test('daysUntil counts whole days regardless of clock time', () => {
  assert.equal(daysUntil('2026-08-24', '2026-08-24'), 0);
  assert.equal(daysUntil('2026-08-27', '2026-08-24'), 3);
  assert.equal(daysUntil('2026-09-03', '2026-08-24'), 10);
  assert.equal(daysUntil('2026-08-20', '2026-08-24'), -4);
});

test('pinLabel shows a weekday only inside the next 7 days', () => {
  const today = '2026-08-24'; // a Monday
  assert.equal(pinLabel('2026-08-24', today), 'Mon', 'today');
  assert.equal(pinLabel('2026-08-27', today), 'Thu', 'this Thursday');
  assert.equal(pinLabel('2026-08-30', today), 'Sun', 'day 6 — still unique');
  // day 7 onwards a weekday repeats, so the date is shown instead
  assert.equal(pinLabel('2026-08-31', today), '31/8', 'day 7');
  assert.equal(pinLabel('2026-09-03', today), '3/9', 'Thursday fortnight');
});

test('two Thursdays are never labelled the same', () => {
  const today = '2026-08-24';
  const thisThu = pinLabel('2026-08-27', today);
  const nextThu = pinLabel('2026-09-03', today);
  assert.notEqual(thisThu, nextThu, 'the whole point of the rule');
});

test('a far-off visit flips to its weekday as the date approaches', () => {
  const visit = '2026-09-03';
  assert.equal(pinLabel(visit, '2026-08-24'), '3/9', 'ten days out: a date');
  assert.equal(pinLabel(visit, '2026-08-28'), 'Thu', 'six days out: a weekday');
});

// ── how soon: the three shades of visit pin ───────────────────────────────

/** The ISO date `n` days after `iso`. */
const plusDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

test('a pin is darkest within the week, the usual blue the week after, lightest from two weeks out', () => {
  const today = '2026-08-24'; // a Monday
  assert.equal(urgencyTier('2026-08-24', today), 'urgent', 'today');
  assert.equal(urgencyTier('2026-08-30', today), 'urgent', 'day 6');
  assert.equal(urgencyTier('2026-08-31', today), 'soon', 'day 7: a week away');
  assert.equal(urgencyTier('2026-09-06', today), 'soon', 'day 13');
  assert.equal(urgencyTier('2026-09-07', today), 'later', 'day 14: two weeks away');
  assert.equal(urgencyTier('2026-12-25', today), 'later', 'months away');
  assert.equal(urgencyTier('2026-08-23', today), 'urgent', 'began yesterday and still running');
});

test('the darkest shade covers exactly the days a pin names its weekday', () => {
  const today = '2026-08-24';
  for (let n = -1; n < 30; n += 1) {
    const date = plusDays(today, n);
    const namesWeekday = /^[A-Z][a-z]{2}$/.test(pinLabel(date, today));
    assert.equal(urgencyTier(date, today) === 'urgent', namesWeekday || n < 0, date);
  }
});

test('a visit moves up a shade as its date approaches', () => {
  const visit = '2026-09-10';
  assert.equal(urgencyTier(visit, '2026-08-24'), 'later', '17 days out');
  assert.equal(urgencyTier(visit, '2026-08-31'), 'soon', '10 days out');
  assert.equal(urgencyTier(visit, '2026-09-05'), 'urgent', '5 days out');
});

test('the demo shows all three shades of visit pin', () => {
  const shades = new Set(sampleVisits().map((v) => urgencyTier(v.date)));
  assert.deepEqual([...shades].sort(), ['later', 'soon', 'urgent']);
});

test('the shades step from dark to light, the lightest still a shade darker than the sea', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const token = (name) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)[1];
  // WCAG relative luminance and contrast ratio
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

  const [urgent, soon, later] = ['visit-urgent', 'visit-soon', 'visit-later'].map(token);
  assert.ok(lum(urgent) < lum(soon) && lum(soon) < lum(later), 'dark, then the usual blue, then the lightest');
  const SEA = '#6ca7e3'; // OneMap's sea: the lightest sample from a screenshot of the live map
  assert.ok(lum(later) < lum(SEA) && contrast(SEA, later) >= 1.15, 'a visible shade darker than the sea');
  assert.ok(contrast(later, token('visit-later-ink')) >= 4.5, "the lightest pin's date stays readable");
  for (const dark of [urgent, soon]) assert.ok(contrast(dark, '#ffffff') >= 4.5, `white text on ${dark}`);
});

test('every shade has a pin colour and a swatch in the map key', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.deepEqual(URGENCY.map((t) => t.key), ['urgent', 'soon', 'later']);
  for (const t of URGENCY) {
    assert.match(css, new RegExp(`\\.pin-${t.key}\\b[^{]*\\{[^}]*background`), `.pin-${t.key}`);
    assert.match(css, new RegExp(`\\.legend-${t.key}\\b[^{]*\\{[^}]*background`), `.legend-${t.key}`);
    assert.ok(t.label.length > 0 && t.label.length <= 10, `"${t.label}" is short enough for the key`);
  }
});

// ── card trail (Back) ─────────────────────────────────────────────────────

import {
  PROSPECT,
  MAX_TRAIL,
  liveStops,
  placeStop,
  popStop,
  pushStop,
  startTrail,
  visitStop,
} from '../src/lib/trail.js';

const WORLD = {
  visits: [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }],
  places: [{ id: 'p1' }],
  hasProspect: true,
};

test('walking from card to card can be walked back', () => {
  let trail = [visitStop('v1')];
  trail = pushStop(trail, visitStop('v2'));
  trail = pushStop(trail, placeStop('p1'));
  assert.deepEqual(liveStops(trail, WORLD).at(-1), placeStop('p1'));

  trail = popStop(trail);
  assert.deepEqual(trail.at(-1), visitStop('v2'), 'back lands on the previous card');
  trail = popStop(trail);
  assert.deepEqual(trail.at(-1), visitStop('v1'));
  assert.deepEqual(popStop(trail), [], 'and finally on the bare map');
});

test('a pin tapped on the map starts a fresh trail, not a deeper one', () => {
  const deep = pushStop(pushStop([visitStop('v1')], visitStop('v2')), placeStop('p1'));
  assert.equal(deep.length, 3);

  const fresh = startTrail(visitStop('v3'));
  assert.deepEqual(fresh, [visitStop('v3')], 'the trail restarts at the tapped pin');
  assert.deepEqual(popStop(fresh), [], 'so Back closes the card instead of reopening the last one');
});

test('a visit removed behind you drops out of the trail', () => {
  const trail = [visitStop('v1'), visitStop('v2'), visitStop('v3')];
  const afterDelete = liveStops(trail, { ...WORLD, visits: [{ id: 'v1' }, { id: 'v3' }] });
  assert.deepEqual(afterDelete, [visitStop('v1'), visitStop('v3')]);
  assert.deepEqual(
    popStop(afterDelete).at(-1),
    visitStop('v1'),
    'back skips the deleted one instead of showing an empty card'
  );
});

test('a visit that ends mid-session drops out too', () => {
  // useVisits stops returning a visit once its end time passes; the trail must
  // not keep pointing at it.
  const trail = [visitStop('v1'), visitStop('v2')];
  assert.deepEqual(liveStops(trail, { ...WORLD, visits: [{ id: 'v1' }] }), [visitStop('v1')]);
});

test('the unsaved prospect leaves the trail when it is cleared', () => {
  const trail = [visitStop(PROSPECT), visitStop('v2')];
  assert.equal(liveStops(trail, WORLD).length, 2);
  assert.deepEqual(liveStops(trail, { ...WORLD, hasProspect: false }), [visitStop('v2')]);
});

test('the trail has a ceiling', () => {
  let trail = [];
  for (let i = 0; i < MAX_TRAIL + 8; i += 1) trail = pushStop(trail, visitStop(`v${i}`));
  assert.equal(trail.length, MAX_TRAIL);
  assert.deepEqual(trail.at(-1), visitStop(`v${MAX_TRAIL + 7}`), 'the newest card is kept');
});

// ── explaining a transit answer ───────────────────────────────────────────

import { transitNote } from '../src/lib/transit.js';

test('a transit answer says where its minutes went', () => {
  const note = transitNote({
    mins: 44, departAt: '13:16', arriveAt: '14:00',
    walkMins: 8, waitMins: 6, transfers: 1,
  });
  assert.equal(note, '13:16–14:00 · 8 min walking · 6 min waiting · 1 transfer');
});

test('a transit answer owns up to being an estimate', () => {
  const note = transitNote({ mins: 41, walkMins: 9, transfers: 2, approx: true });
  assert.match(note, /2 transfers/);
  assert.match(note, /typical for this weekday/);
  assert.doesNotMatch(note, /waiting/, 'nothing invented for figures OneMap did not give');
});

test('a bare answer produces a bare note, not empty scaffolding', () => {
  assert.equal(transitNote({ mins: 20, transfers: 0 }), '');
});
