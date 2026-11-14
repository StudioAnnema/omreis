// Omreis-tussenlaag (Cloudflare Worker).
//  /voertuigen?min=lat,lon&max=lat,lon  -> echte gps-posities van bussen, trams en metro's (open NDOV-feed via OVapi)
//  /ns/<pad>                            -> doorgeefluik naar de NS-API; de sleutel blijft hier en komt nooit in de app
import { decodeVehicles } from './gtfsrt.js';

const ALLOWED_ORIGINS = ['https://studioannema.github.io', 'http://localhost:4182'];
const FEED = 'https://gtfs.ovapi.nl/nl/vehiclePositions.pb';
const NS_BASE = 'https://gateway.apiportal.ns.nl';
const NS_PREFIXES = ['/virtual-train-api/', '/reisinformatie-api/'];   // alleen deze twee NS-API's mogen erdoor

const json = (data, status, headers, maxAge) => new Response(JSON.stringify(data), {
  status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge || 0}` }
});

/** Alle voertuigen uit de feed. De bron mag niet te vaak bevraagd worden, dus het resultaat wordt kort
 *  hergebruikt (20 seconden in het geheugen, plus 20 seconden aan de rand van Cloudflare). Weigert de bron even, dan gaat de vorige lijst mee. */
let memo = { at: 0, list: null };
async function allVehicles(ctx) {
  const now = Date.now();
  if (memo.list && now - memo.at < 20000) return memo.list;
  try {
    const r = await fetch(FEED, { headers: { 'User-Agent': 'omreis-reisapp/1.0 (github.com/StudioAnnema)' }, cf: { cacheTtl: 20, cacheEverything: true } });
    if (!r.ok) throw new Error('feed gaf ' + r.status);
    const list = decodeVehicles(new Uint8Array(await r.arrayBuffer())).map(v => ({
      t: v.tripId, r: v.routeId, la: +v.lat.toFixed(5), lo: +v.lon.toFixed(5), ts: v.time || 0, s: v.status ?? 2, v: v.vehicle || ''
    }));
    memo = { at: now, list };
    return list;
  } catch (err) {
    if (memo.list && now - memo.at < 180000) return memo.list;   // liever iets oudere posities dan geen
    throw err;
  }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), origin = req.headers.get('Origin') || '';
    const known = ALLOWED_ORIGINS.includes(origin);
    const cors = { 'Access-Control-Allow-Origin': known ? origin : ALLOWED_ORIGINS[0], 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'GET') return json({ fout: 'alleen opvragen is toegestaan' }, 405, cors);

    try {
      if (url.pathname === '/voertuigen') {
        const [n, w] = (url.searchParams.get('min') || '').split(',').map(Number);
        const [s, e] = (url.searchParams.get('max') || '').split(',').map(Number);
        if (![n, w, s, e].every(Number.isFinite)) return json({ fout: 'geef min=noord,west en max=zuid,oost' }, 400, cors);
        const list = (await allVehicles(ctx)).filter(v => v.la <= n && v.la >= s && v.lo >= w && v.lo <= e);
        return json(list, 200, cors, 8);
      }

      if (url.pathname.startsWith('/ns/')) {
        // De NS-sleutel is persoonlijk: alleen verzoeken vanuit de app zelf worden doorgelaten.
        if (!known) return json({ fout: 'niet toegestaan vanaf deze herkomst' }, 403, cors);
        if (!env.NS_KEY) return json({ fout: 'NS-sleutel is nog niet ingesteld' }, 503, cors);
        const path = url.pathname.slice(3);
        if (!NS_PREFIXES.some(p => path.startsWith(p)) || path.includes('..')) return json({ fout: 'dit pad is niet toegestaan' }, 403, cors);
        const r = await fetch(NS_BASE + path + url.search, { headers: { 'Ocp-Apim-Subscription-Key': env.NS_KEY, Accept: 'application/json' }, cf: { cacheTtl: 15, cacheEverything: true } });
        return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': r.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'public, max-age=15' } });
      }

      if (url.pathname === '/') return json({ omreis: 'tussenlaag werkt', nsSleutel: env.NS_KEY ? 'ingesteld' : 'ontbreekt' }, 200, cors);
      return json({ fout: 'onbekend adres' }, 404, cors);
    } catch (err) {
      return json({ fout: String(err.message || err) }, 502, cors);
    }
  }
};
