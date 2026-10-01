import { oneMapFetch } from './token.js';

// Singapore postal codes are six digits, and they pin a building exactly —
// far more reliably than a typed street address, so they're tried first.
const POSTAL = /\b(\d{6})\b/;

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
 * Where a calendar event's Location is, or null if OneMap can't find it.
 * Postal code first; failing that, the whole text (trimmed, since people
 * sometimes paste a paragraph into Location).
 */
export async function geocodeLocation(location) {
  const text = String(location || '').replace(/\s+/g, ' ').trim();
  if (text.length < 3) return null;
  const postal = POSTAL.exec(text)?.[1];
  if (postal) {
    const hit = await cached(postal);
    if (hit) return hit;
  }
  return cached(text.slice(0, 120));
}
