/**
 * A transit answer spelled out — for the tooltip on a compact row.
 *
 * The headline number cannot tell you where the minutes go, and a journey that
 * is mostly standing at a bus stop is not the same as one that is mostly
 * moving. This says which it is.
 *
 * Every line is built from what OneMap actually returned: a figure it did not
 * give is left out rather than guessed at.
 */
export function transitNote(r) {
  const bits = [];
  if (r.departAt && r.arriveAt) bits.push(`${r.departAt}–${r.arriveAt}`);
  if (r.walkMins) bits.push(`${r.walkMins} min walking`);
  if (r.waitMins) bits.push(`${r.waitMins} min waiting`);
  if (r.transfers) bits.push(`${r.transfers} transfer${r.transfers > 1 ? 's' : ''}`);
  if (r.approx) {
    bits.push('typical for this weekday — timetables are not published this far ahead');
  }
  return bits.join(' · ');
}
