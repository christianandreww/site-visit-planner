import { oneMapFetch } from './_lib/token.js';

/**
 * GET /api/search?q=<address or postal code>
 * Proxies OneMap's address search so the token stays server-side.
 * Returns: { results: [{ label, address, postal, lat, lng }] }
 */
export default async function handler(req, res) {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) {
    return res.status(400).json({ error: 'Type at least 3 characters.' });
  }

  try {
    const url =
      'https://www.onemap.gov.sg/api/common/elastic/search' +
      `?searchVal=${encodeURIComponent(q)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    const upstream = await oneMapFetch(url);
    if (!upstream.ok) {
      return res
        .status(502)
        .json({ error: `OneMap search failed (HTTP ${upstream.status}).` });
    }

    let data = await upstream.json();

    // OneMap sometimes reports auth problems as HTTP 200 + an "error" field.
    // If that happens, refresh the token once and retry before giving up.
    if (data && data.error && /token|auth/i.test(String(data.error))) {
      const retry = await oneMapFetch(url, { forceRefresh: true });
      data = await retry.json().catch(() => data);
    }
    if (data && data.error) {
      return res.status(502).json({ error: `OneMap: ${data.error}` });
    }

    const results = (data.results || [])
      .slice(0, 6)
      .map((r) => ({
        label: r.SEARCHVAL || r.ADDRESS,
        address: r.ADDRESS,
        postal: r.POSTAL && r.POSTAL !== 'NIL' ? r.POSTAL : '',
        lat: parseFloat(r.LATITUDE),
        lng: parseFloat(r.LONGITUDE),
      }))
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));

    // Same query can be served from Vercel's edge cache for a day.
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=86400');
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Search failed.' });
  }
}
