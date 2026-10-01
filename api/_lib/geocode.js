import { oneMapFetch } from './token.js';
import { findPostal, findStreet } from './address.js';

// Remembered for as long as this server instance stays warm, so a calendar
// read every few minutes doesn't look the same addresses up every time.
const cache = new Map();

async function searchOneMap(query) {
  const url =
    'https://www.onemap.gov.sg/api/common/elastic/search' +
    `?searchVal=${encodeURIComponent(query)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
  let res = await oneMapFetch(url);
  if (!res.ok) throw new Error(`OneMap search failed (HTTP ${res.status}).`);
  let data = await res.json();
  if (data && data.error && /token|auth/i.test(String(data.error))) {
    res = await oneMapFetch(url, { forceRefresh: true });
    data = await res.json().catch(() => data);
  }
  if (data && data.error) throw new Error(`OneMap: ${data.error}`);
  for (const r of data.results || []) {
    const lat = parseFloat(r.LATITUDE);
    const lng = parseFloat(r.LONGITUDE);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return {
        address: r.ADDRESS,
        postal: r.POSTAL && r.POSTAL !== 'NIL' ? r.POSTAL : '',
        blk: String(r.BLK_NO && r.BLK_NO !== 'NIL' ? r.BLK_NO : '').toUpperCase(),
        lat,
        lng,
      };
    }
  }
  return null;
}

async function cached(query) {
  const key = query.toLowerCase();
  if (!cache.has(key)) cache.set(key, await searchOneMap(query));
  return cache.get(key);
}

/**
 * A street address found in free text, looked up with its street type spelled
 * out ("Ave" → "Avenue") — and only accepted if OneMap's answer is the same
 * block. Without that check, "123 Some Road" could snap to a different 123
 * elsewhere, and a wrong pin is worse than a missing one.
 */
async function verifiedStreet(street) {
  if (!street) return null;
  const hit = await cached(street.query);
  if (!hit) return null;
  const sameBlock =
    hit.blk === street.blk || String(hit.address || '').toUpperCase().startsWith(`${street.blk} `);
  return sameBlock ? hit : null;
}

/**
 * Where a calendar event's Location is, or null if OneMap can't find it.
 * Postal code first — six digits pin a building exactly, far more reliably
 * than a typed street — then the whole text (trimmed, since people sometimes
 * paste a paragraph into Location), then any street address inside it.
 */
export async function geocodeLocation(location) {
  const text = String(location || '').replace(/\s+/g, ' ').trim();
  if (text.length < 3) return null;
  const postal = findPostal(text);
  if (postal) {
    const hit = await cached(postal.code);
    if (hit) return hit;
  }
  return (await cached(text.slice(0, 120))) || verifiedStreet(findStreet(text));
}

/**
 * Where an address written into an event's title is (see splitTitle), or null.
 * Titles mix the address with the client's name, so only the parts that are
 * unmistakably an address are used: a postal code, or a street address whose
 * block number OneMap confirms.
 */
export async function geocodeTitle({ postal, street }) {
  if (postal) {
    const hit = await cached(postal);
    if (hit) return hit;
  }
  return verifiedStreet(street);
}
