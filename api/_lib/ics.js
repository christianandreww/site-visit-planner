// A small, dependency-free reader for iCalendar (.ics) feeds — enough to turn
// the planner calendar's private feed into site visits. It deliberately reads
// only what the map needs: when, where, what it's called, and who sent it.

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000; // Singapore has no daylight saving
const SG_ZONE = 'Asia/Singapore';

/** Undo RFC 5545 line folding: a line starting with a space or tab continues the one before. */
function unfold(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

/** Split `NAME;PARAM=a;PARAM2="x:y":value` into its parts. Quoted params may contain colons. */
function parseLine(line) {
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ':' && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [rawName, ...rawParams] = head.split(';');
  const params = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: rawName.toUpperCase(), params, value };
}

/** TEXT values escape commas, semicolons, backslashes and newlines. */
function unescapeText(value) {
  return value.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** How far a time zone is ahead of UTC at a given instant, in ms. */
function zoneOffsetMs(timeZone, epochMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(epochMs));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wallAsUtc - epochMs;
}

/**
 * The instant a wall-clock time in some zone refers to. Two passes cover the
 * rare case where the first guess lands on the other side of a DST change.
 * Unknown zone names (Outlook sometimes writes Windows names like
 * "Singapore Standard Time") fall back to Singapore time.
 */
function zonedToEpoch(y, mo, d, h, mi, s, timeZone) {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  let zone = timeZone || SG_ZONE;
  try {
    zoneOffsetMs(zone, asUtc);
  } catch {
    zone = SG_ZONE;
  }
  if (zone === SG_ZONE) return asUtc - SGT_OFFSET_MS;
  const first = asUtc - zoneOffsetMs(zone, asUtc);
  const second = asUtc - zoneOffsetMs(zone, first);
  return second;
}

/**
 * A DTSTART/DTEND value as a point in time.
 *   20261009T060000Z               — UTC
 *   TZID=Asia/Singapore:20261009T140000 — wall time in a named zone
 *   20261009T140000                — "floating"; read as Singapore time
 *   VALUE=DATE:20261009            — an all-day date
 */
export function parseIcsTime(value, params = {}) {
  const v = String(value || '').trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly || params.VALUE === 'DATE') {
    const m = dateOnly || /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    const [, y, mo, d] = m.map(Number);
    return { allDay: true, epochMs: Date.UTC(y, mo - 1, d) - SGT_OFFSET_MS };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  const epochMs = m[7] === 'Z' ? Date.UTC(y, mo - 1, d, h, mi, s) : zonedToEpoch(y, mo, d, h, mi, s, params.TZID);
  return { allDay: false, epochMs };
}

/** 'YYYY-MM-DD' and 'HH:MM' in Singapore for an instant. */
export function sgDateTime(epochMs) {
  const iso = new Date(epochMs + SGT_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

const emailOf = (value) =>
  String(value || '')
    .replace(/^mailto:/i, '')
    .trim()
    .toLowerCase();

/**
 * Every event in a feed. Components nested inside an event — reminders
 * (VALARM) in particular — are skipped, so a reminder's own DESCRIPTION can't
 * overwrite the event's.
 */
export function parseIcs(text) {
  const events = [];
  let current = null;
  let nested = 0;

  for (const line of unfold(text)) {
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VEVENT') {
      current = { attendees: [] };
      nested = 0;
      continue;
    }
    if (!current) continue;
    if (upper === 'END:VEVENT') {
      events.push(current);
      current = null;
      continue;
    }
    if (upper.startsWith('BEGIN:')) {
      nested += 1;
      continue;
    }
    if (upper.startsWith('END:')) {
      nested = Math.max(0, nested - 1);
      continue;
    }
    if (nested > 0) continue;

    const prop = parseLine(line);
    if (!prop) continue;
    switch (prop.name) {
      case 'UID':
        current.uid = prop.value.trim();
        break;
      case 'SUMMARY':
        current.summary = unescapeText(prop.value).trim();
        break;
      case 'LOCATION':
        current.location = unescapeText(prop.value).trim();
        break;
      case 'DESCRIPTION':
        current.description = unescapeText(prop.value).trim();
        break;
      case 'STATUS':
        current.status = prop.value.trim().toUpperCase();
        break;
      case 'ORGANIZER':
        current.organizer = emailOf(prop.value);
        break;
      case 'ATTENDEE':
        current.attendees.push(emailOf(prop.value));
        break;
      case 'DTSTART':
        current.start = parseIcsTime(prop.value, prop.params);
        break;
      case 'DTEND':
        current.end = parseIcsTime(prop.value, prop.params);
        break;
      case 'RRULE':
        current.recurring = true;
        break;
      case 'RECURRENCE-ID':
        current.recurrenceId = prop.value.trim();
        break;
      default:
        break;
    }
  }
  return events.filter((e) => e.start);
}
