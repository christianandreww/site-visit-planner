// Picking a Singapore address out of free text — in particular a calendar
// event's title, for reps who write "Site visit – Mr Tan, 550123" instead of
// filling in Location.
//
// The rule throughout: a missing pin is better than a wrong one. A postal code
// is trusted; a street address is only used when OneMap's answer has the same
// block number (checked in geocode.js); anything vaguer is left alone.

/**
 * Six digits standing on their own: "550123", "S550123", "S(550123)",
 * "Singapore 550123" — but not part of a longer number such as a phone
 * (91234567), and not a unit number like #05-12.
 */
const POSTAL = /(?<!\d)(\d{6})(?!\d)/;

// The word that ends an English-style Singapore street name ("… Avenue 3"),
// and the long form OneMap is surest to recognise.
const SUFFIXES = {
  road: 'Road', rd: 'Road', street: 'Street', st: 'Street', avenue: 'Avenue', ave: 'Avenue',
  drive: 'Drive', dr: 'Drive', lane: 'Lane', ln: 'Lane', crescent: 'Crescent', cres: 'Crescent',
  close: 'Close', cl: 'Close', walk: 'Walk', way: 'Way', place: 'Place', pl: 'Place',
  terrace: 'Terrace', ter: 'Terrace', grove: 'Grove', hill: 'Hill', park: 'Park', rise: 'Rise',
  view: 'View', link: 'Link', central: 'Central', ring: 'Ring', loop: 'Loop', circle: 'Circle',
  boulevard: 'Boulevard', blvd: 'Boulevard', garden: 'Garden', gardens: 'Gardens', gdns: 'Gardens',
  heights: 'Heights', hts: 'Heights', vale: 'Vale', green: 'Green', square: 'Square', sq: 'Square',
  quay: 'Quay', plain: 'Plain', estate: 'Estate', vista: 'Vista', turn: 'Turn', bend: 'Bend',
};

// Malay-style names put the street type first: "Jalan Bukit Merah", "Lorong 1 Toa Payoh".
const PREFIXES = {
  jalan: 'Jalan', jln: 'Jalan', lorong: 'Lorong', lor: 'Lorong', lengkok: 'Lengkok',
  lengkong: 'Lengkong', taman: 'Taman', tanjong: 'Tanjong', tg: 'Tanjong',
};

// A street name never runs on into "Mr Tan": an honorific ends it.
const HONORIFIC = String.raw`(?:mr|mrs|ms|mdm|madam|miss|mister|dr)\b`;
const WORD = String.raw`(?!${HONORIFIC})[a-z][a-z'.-]*`;
const NUM = String.raw`\d{1,4}[a-z]?`;
const LEAD = String.raw`(?:(?:blk|block)\s*)?`;

// "123 Serangoon Ave 3": number, up to four words, a street type, maybe a number.
const ENGLISH = new RegExp(
  String.raw`\b${LEAD}(${NUM})\s+((?:${WORD}\s+){0,4})` +
    String.raw`(${Object.keys(SUFFIXES).join('|')})\b\.?(?:\s+(\d{1,3}[a-z]?)\b)?`,
  'i'
);
// "7 Jalan Bukit Merah": number, a Malay street type, then up to four words.
const MALAY = new RegExp(
  String.raw`\b${LEAD}(${NUM})\s+(${Object.keys(PREFIXES).join('|')})\b\.?` +
    String.raw`((?:\s+(?!${HONORIFIC})[a-z0-9][a-z0-9'.-]*){1,4})`,
  'i'
);

/** The postal code in some text, and where it sits, or null. */
export function findPostal(text) {
  const m = POSTAL.exec(String(text || ''));
  return m ? { code: m[1], index: m.index } : null;
}

/**
 * A street address in some text — "Blk 123 Serangoon Ave 3", "1 Sireh Place",
 * "7 Jalan Bukit Merah" — or null. `query` spells the street type out in full
 * for the OneMap search; `blk` is the block or house number to verify against.
 */
export function findStreet(text) {
  const s = String(text || '');
  const en = ENGLISH.exec(s);
  const ms = MALAY.exec(s);
  // Whichever starts first in the text; English if they tie.
  const m = en && (!ms || en.index <= ms.index) ? en : ms;
  if (!m) return null;
  if (m === en) {
    const [, blk, words, suffix, trailing] = m;
    const query = [blk, words.trim(), SUFFIXES[suffix.toLowerCase()], trailing].filter(Boolean).join(' ');
    return { text: m[0].trim(), index: m.index, blk: blk.toUpperCase(), query };
  }
  const [, blk, prefix, rest] = m;
  const query = [blk, PREFIXES[prefix.toLowerCase()], rest.trim()].join(' ');
  return { text: m[0].trim(), index: m.index, blk: blk.toUpperCase(), query };
}

const SEPARATORS = /^[\s,;:|@–—-]+|[\s,;:|@–—-]+$/g;

/**
 * Split an event title into the client's name and any address written into it.
 *
 *   "Site visit – Mr Tan, Blk 123 Serangoon Ave 3, 550123"
 *        → name "Mr Tan", address "Blk 123 Serangoon Ave 3, 550123"
 *   "Mdm Lee S550123"                → name "Mdm Lee", address "S550123"
 *   "Mr Tan at 1 Sireh Place"        → name "Mr Tan", address "1 Sireh Place"
 *   "Site visit – Tan, Ah Kow"       → name "Tan, Ah Kow", no address
 */
export function splitTitle(summary) {
  const text = String(summary || '').replace(/\s+/g, ' ').trim();
  const rest = text.replace(/^site\s*visits?\b\s*(?:[-–—:|@]|at\b)?\s*/i, '').trim();
  const postal = findPostal(rest);
  const street = findStreet(rest);
  const none = { address: '', postal: '', street: null };
  if (!postal && !street) return { name: rest || text || 'Site visit', ...none };

  // The address is the stretch of the title covering the street and/or the
  // postal code (with a "Singapore" or "S(" in front of it); the rest is the name.
  let start = Infinity;
  let end = -1;
  if (street) {
    start = street.index;
    end = street.index + street.text.length;
  }
  if (postal) {
    let pStart = postal.index;
    let pEnd = postal.index + 6;
    const lead = /(?:singapore\s*|\bs\s*\(?\s*)$/i.exec(rest.slice(0, pStart));
    if (lead) pStart -= lead[0].length;
    if (rest[pEnd] === ')') pEnd += 1;
    start = Math.min(start, pStart);
    end = Math.max(end, pEnd);
  }
  // A unit number straight after the address belongs to it: "…Dr 3, #05-12".
  const unit = /^[\s,]*#\d{1,3}-\d{1,5}[a-z]?/i.exec(rest.slice(end));
  if (unit) end += unit[0].length;

  const address = rest.slice(start, end).replace(SEPARATORS, '');
  const name = `${rest.slice(0, start)} ${rest.slice(end)}`
    .replace(/[()]/g, ' ')
    .replace(/(?:^|\s)(?:at|@)\s*$/i, ' ') // "Mr Tan at …"
    .replace(/^\s*(?:at|@)\s/i, ' ') // "… at …" with the name after
    .replace(/\s+([,;])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(SEPARATORS, '')
    .trim();

  return {
    name: name || 'Site visit',
    address,
    postal: postal ? postal.code : '',
    street,
  };
}
