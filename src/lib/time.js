// All appointments are physical events in Singapore, so every calculation is
// pinned to Singapore time (+08:00). A phone that happens to be overseas will
// still show the correct local-to-the-property times.

export const TZ = 'Asia/Singapore';
const SGT_OFFSET = '+08:00';

/** Date object for a given ISO date ('2026-08-21') and time ('14:00') in SGT. */
export function atSG(dateISO, timeHM) {
  return new Date(`${dateISO}T${timeHM}:00${SGT_OFFSET}`);
}

/** Epoch millis at which a visit ends — used to hide (not delete) past visits. */
export function endTimestamp(dateISO, endHM) {
  return atSG(dateISO, endHM).getTime();
}

/** Epoch millis at which a visit starts. */
export function startTimestamp(dateISO, startHM) {
  return atSG(dateISO, startHM).getTime();
}

/** Do two [start, end) time ranges overlap? Back-to-back does not count. */
export function rangesOverlap(s1, e1, s2, e2) {
  return s1 < e2 && s2 < e1;
}

/** 'Tue, 18 Aug' */
export function fmtDate(dateISO) {
  return atSG(dateISO, '00:00').toLocaleDateString('en-SG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: TZ,
  });
}

/** '2:00 pm' → normalised to '2:00 PM' */
export function fmtTime(dateISO, timeHM) {
  return atSG(dateISO, timeHM)
    .toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit', timeZone: TZ })
    .toUpperCase();
}

/** '2:00 PM – 3:00 PM' */
export function fmtRange(visit) {
  return `${fmtTime(visit.date, visit.start)} – ${fmtTime(visit.date, visit.end)}`;
}

/**
 * Singapore's current date and time, rounded down to the quarter hour.
 * Used as the departure time for transit lookups that have no scheduled time
 * of their own; rounding keeps the request URL — and so the cached answer —
 * stable instead of changing every second.
 */
export function nowSG() {
  const d = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
  const hm = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  const [h, m] = hm.split(':').map(Number);
  const quarter = Math.floor(m / 15) * 15;
  return { date, time: `${String(h).padStart(2, '0')}:${String(quarter).padStart(2, '0')}` };
}

/** Whole-day number for an ISO date, for comparing dates without clocks. */
function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** Days from today (Singapore) to an ISO date. Negative means past. */
export function daysUntil(dateISO, today = todayISO()) {
  return dayNumber(dateISO) - dayNumber(today);
}

/**
 * The label shown on a pin and in list rows.
 *
 * A weekday name is only unambiguous inside a 7-day window — beyond that,
 * "Thu" could be this Thursday or any later one, which makes four Thursday
 * pins look like four visits this week. So: weekday within the next 7 days,
 * and a D/M date after that. As the weeks pass a far-off visit flips to its
 * weekday on its own.
 */
export function pinLabel(dateISO, today = todayISO()) {
  const diff = daysUntil(dateISO, today);
  if (diff >= 0 && diff <= 6) return weekdayShort(dateISO);
  const [, m, d] = dateISO.split('-').map(Number);
  return `${d}/${m}`;
}

/** 'Tue' — short weekday label shown inside map pins. */
export function weekdayShort(dateISO) {
  return atSG(dateISO, '00:00').toLocaleDateString('en-SG', {
    weekday: 'short',
    timeZone: TZ,
  });
}

/** Today's date in Singapore as 'YYYY-MM-DD' (en-CA locale formats ISO-style). */
export function todayISO(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

/** '14:00' + 60 minutes → '15:00' (clamped to the same day). */
export function addMinutes(timeHM, minutes) {
  const [h, m] = timeHM.split(':').map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
