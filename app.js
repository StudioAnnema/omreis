/* Omreis – OV-reis volgen met live alternatieven. Data: Transitous (MOTIS API). */
'use strict';
const API = 'https://api.transitous.org/api';
const REFRESH_MS = 30000;
const VERSION = 32;
const PROXY = 'https://omreis-api.studioannema.workers.dev';   // eigen tussenlaag: echte gps-posities en NS-gegevens
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* vol of geblokkeerd */ } }
};

const state = {
  from: null, to: null,           // {label, place, lat, lon}
  results: [], sel: 0, cursors: {}, paged: false, searching: false, lastSearch: 0,
  trip: store.get('omreis.trip', null),   // {itin, label, origEnd, sim, updated, started}
  problems: [], problemKey: '',
  alts: null, altsLoading: false, altsFor: '',
  modal: null,                    // pop-up "andere vertrektijd"
  gps: null,
  stopsOpen: false, showAll: false, ride: null, best: null, near: null, vehOn: store.get('omreis.veh', true),
  favs: store.get('omreis.favs', []),
  saved: store.get('omreis.saved', []), places: store.get('omreis.places', {}), recent: store.get('omreis.recent', []),
  pickFor: null, editing: false,
  lines: store.get('omreis.lines', []), lineFilter: null,
  board: null
};

/* ---------- iconen (eigen lijnset, 24px raster) ---------- */
const I = {
  train: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 14h.01M15 14h.01M8 21l2-4M16 21l-2-4"/>',
  bus: '<rect x="4" y="4" width="16" height="13" rx="2.5"/><path d="M4 11h16M8 14h.01M16 14h.01M7 17v2.5M17 17v2.5"/>',
  tram: '<rect x="6" y="6" width="12" height="12" rx="2.5"/><path d="M12 6V3M8 3h8M6 12h12M9 21l1-3M15 21l-1-3"/>',
  metro: '<circle cx="12" cy="12" r="9"/><path d="M8 16V9l4 5 4-5v7"/>',
  ferry: '<path d="M3 18c2 1.6 4 1.6 6 0 2 1.6 4 1.6 6 0 2 1.6 4 1.6 6 0M5 14.5 6 9h12l1 5.5M12 9V5"/>',
  walk: '<circle cx="13" cy="4.5" r="1.6"/><path d="M9 21l2.5-6.5L9.5 12l1-4.5 3.5 3 3 1M10.5 7.5 8 9.5v3M14 15l1 6"/>',
  pin: '<path d="M12 21s-6-5.5-6-10a6 6 0 1 1 12 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>',
  stop: '<rect x="7" y="3" width="10" height="8" rx="2"/><path d="M12 11v10M9 21h6"/>',
  locate: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  swap: '<path d="M8 4v16M8 20l-3-3M8 20l3-3M16 20V4M16 4l-3 3M16 4l3 3"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 4 21 20H3zM12 10v4M12 17v.01"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  home: '<path d="M4 11l8-7 8 7M6 10v9h12v-9M10 19v-5h4v5"/>',
  work: '<rect x="4" y="8" width="16" height="11" rx="2"/><path d="M9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M4 13h16"/>'
};
const svg = n => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;
document.querySelectorAll('[data-ic]').forEach(el => { el.outerHTML = svg(el.dataset.ic); });

/* ---------- hulpfuncties ---------- */
const ms = t => new Date(t).getTime();
const hhmm = t => new Date(t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' });
const mins = msec => Math.round(msec / 60000);
const dur = sec => { const m = Math.round(sec / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} u ${m % 60} min`; };
const isTransit = l => l.mode !== 'WALK' && !!l.tripId;
const isRail = m => /RAIL|TRAIN|LONG_DISTANCE/.test(m || '');
const MODE_IC = { WALK: 'walk', BUS: 'bus', COACH: 'bus', TRAM: 'tram', SUBWAY: 'metro', METRO: 'metro', FERRY: 'ferry' };
const modeIcon = m => svg(MODE_IC[m] || (isRail(m) ? 'train' : 'bus'));
const KIND = { BUS: 'Bus', COACH: 'Bus', TRAM: 'Tram', SUBWAY: 'Metro', METRO: 'Metro', FERRY: 'Veer' };
// "Leiden, Station Leiden Centraal (Uitstaphalte)" -> "Leiden Centraal"
function nice(name) {
  let s = String(name || '').replace(/\s*\((uitstaphalte|instaphalte|uitstap|instap)\)/i, '');
  const m = s.match(/^([^,]+),\s*(.+)$/);
  if (m && m[2].toLowerCase().includes(m[1].toLowerCase())) s = m[2];
  return s.replace(/^Station\s+/i, '').trim();
}
// "bus 2", "tram 3", "trein (Sprinter)": zegt meteen wat voor voertuig het is
function rideName(l, cap) {
  const n = l.displayName || l.routeShortName || '', k = KIND[l.mode];
  const s = k ? `${k.toLowerCase()} ${n}`.trim() : `trein${n ? ` (${n})` : ''}`;
  return cap ? s[0].toUpperCase() + s.slice(1) : s;
}
const theRide = l => (KIND[l.mode] ? '' : 'de ') + rideName(l);
function legName(l) {
  const n = l.displayName || l.routeShortName || '';
  const kind = KIND[l.mode];
  return kind ? `${kind} ${n}`.trim() : (n || 'Trein');
}
const hex = c => /^[0-9a-f]{6}$/i.test(c || '') ? `#${c}` : '';
function chip(l) {
  if (l.mode === 'WALK') return `<span class="chip walk">${svg('walk')}${Math.max(1, Math.round(l.duration / 60))} min</span>`;
  const bg = hex(l.routeColor), fg = hex(l.routeTextColor) || '#fff';
  const short = l.displayName || l.routeShortName || '';
  return `<span class="chip${bg ? ' line' : ''}"${bg ? ` style="background:${bg};color:${fg}"` : ''}>${modeIcon(l.mode)}${esc(short)}</span>`;
}
function delayHtml(actual, sched) {
  const d = mins(ms(actual) - ms(sched));
  return d >= 1 ? ` <span class="late">+${d}</span>` : '';
}
function distM(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const placeOf = p => p.stopId || `${p.lat},${p.lon}`;
const walkMin = it => Math.round(it.legs.filter(l => l.mode === 'WALK').reduce((s, l) => s + (l.duration || 0), 0) / 60);
// Rangorde van reizen: aankomsttijd, plus een "prijs" per overstap en extra voor een krappe overstap.
// Een rechtstreekse trein die 5 minuten later aankomt wint zo van drie keer overstappen.
function rank(it, fromTime) {
  const tr = it.legs.filter(l => isTransit(l) && (!fromTime || ms(l.endTime) > fromTime));
  let p = Math.max(0, tr.length - 1) * 7 * 60000;
  for (let i = 1; i < tr.length; i++) if (ms(tr[i].startTime) - ms(tr[i - 1].endTime) < 4 * 60000) p += 5 * 60000;
  return ms(it.endTime) + p;
}
const transfersText = n => n === 0 ? 'rechtstreeks' : n === 1 ? '1 overstap' : `${n} overstappen`;
const platform = p => p.track ? ` · perron ${esc(p.track)}` : '';

async function api(path, params) {
  const u = new URL(API + path);
  Object.entries(params).forEach(([k, v]) => v != null && v !== '' && u.searchParams.set(k, v));
  const r = await fetch(u, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`server gaf ${r.status}`);
  return r.json();
}

/* ---------- kaart (vectorkaart via MapLibre + OpenFreeMap) ---------- */
let map = null, mapReady = false, meMarker = null, mapKey = '', mapPitch = 0;
const fc = f => ({ type: 'FeatureCollection', features: f });
const BRAND = '#5B2EFF', DEEP = '#2B1A66';
function initMap() {
  if (!window.maplibregl) return;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const MAPS = window.OMREIS_MAPS || {};
  const def = MAPS[store.get('omreis.map2', null)] || MAPS.circuit || { style: 'https://tiles.openfreemap.org/styles/liberty' };
  map = new maplibregl.Map({
    container: 'map', style: def.style,
    center: [5.2, 52.2], zoom: 7, minZoom: 6.3, maxBounds: [[2.2, 50.3], [8.3, 54.0]], pitch: def.pitch || 0, maxPitch: 65, attributionControl: false, antialias: true, fadeDuration: 150
  });
  mapPitch = def.pitch || 0;
  map.touchZoomRotate.disableRotation(); map.touchPitch.disable(); map.dragRotate.disable();   // op een telefoon alleen schuiven en knijpen
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Reisinformatie: <a href="https://transitous.org/sources/" target="_blank" rel="noopener">Transitous</a>' }), 'top-left');
  map.on('load', () => {
    document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    window.OMREIS_MAP_NL?.(map); def.tweak?.(map);
    ['net', 'route', 'pts', 'stops', 'veh'].forEach(id => map.addSource(id, { type: 'geojson', data: fc([]) }));
    const round = { 'line-cap': 'round', 'line-join': 'round' };
    // lijnennet: de routes waar nu bussen, trams en metro's rijden, in de kleur van de lijn
    map.addLayer({ id: 'net', type: 'line', source: 'net', minzoom: 10.5, layout: round, paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.75, 'line-width': ['interpolate', ['linear'], ['zoom'], 10.5, 1.2, 14, 3, 17, 5] } });
    map.addLayer({ id: 'route-glow', type: 'line', source: 'route', filter: ['==', ['get', 'kind'], 'transit'], layout: round, paint: { 'line-color': ['get', 'color'], 'line-width': 18, 'line-blur': 10, 'line-opacity': 0.35 } });
    map.addLayer({ id: 'route-case', type: 'line', source: 'route', filter: ['==', ['get', 'kind'], 'transit'], layout: round, paint: { 'line-color': '#fff', 'line-width': 9 } });
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', filter: ['==', ['get', 'kind'], 'transit'], layout: round, paint: { 'line-color': ['get', 'color'], 'line-width': 5.5, 'line-opacity': ['get', 'opacity'] } });
    map.addLayer({ id: 'route-walk', type: 'line', source: 'route', filter: ['==', ['get', 'kind'], 'walk'], layout: round, paint: { 'line-color': DEEP, 'line-width': 4, 'line-dasharray': [0.1, 2] } });
    map.addLayer({ id: 'stops', type: 'circle', source: 'stops', minzoom: 14, paint: { 'circle-radius': ['case', ['get', 'rail'], 9, 4.5], 'circle-color': ['case', ['get', 'rail'], BRAND, '#fff'], 'circle-stroke-color': ['case', ['get', 'rail'], '#fff', '#A99BE8'], 'circle-stroke-width': ['case', ['get', 'rail'], 3, 2] } });
    map.addLayer({ id: 'stops-name', type: 'symbol', source: 'stops', minzoom: 14, filter: ['==', ['get', 'rail'], true], layout: { 'text-field': ['get', 'name'], 'text-size': 13, 'text-font': ['Noto Sans Bold'], 'text-anchor': 'top', 'text-offset': [0, 1] }, paint: { 'text-color': DEEP, 'text-halo-color': '#fff', 'text-halo-width': 2 } });
    map.addLayer({ id: 'pts', type: 'circle', source: 'pts', paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['get', 'fill'], 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 3.5 } });
    map.addLayer({ id: 'pts-label', type: 'symbol', source: 'pts', filter: ['!=', ['get', 'label'], ''], layout: { 'text-field': ['get', 'label'], 'text-size': 12.5, 'text-font': ['Noto Sans Bold'], 'text-anchor': 'top', 'text-offset': [0, 0.9], 'text-allow-overlap': true }, paint: { 'text-color': DEEP, 'text-halo-color': '#fff', 'text-halo-width': 2 } });
    map.addLayer({ id: 'veh-glow', type: 'circle', source: 'veh', paint: { 'circle-radius': ['case', ['get', 'sel'], 24, 15], 'circle-color': ['get', 'color'], 'circle-opacity': 0.3, 'circle-blur': 0.6 } });
    map.addLayer({ id: 'veh-c', type: 'circle', source: 'veh', paint: { 'circle-radius': ['case', ['get', 'sel'], 11, 7.5], 'circle-color': ['get', 'color'], 'circle-stroke-color': ['case', ['get', 'sel'], '#C8F53C', '#fff'], 'circle-stroke-width': ['case', ['get', 'sel'], 4, 2.2] } });
    map.addLayer({ id: 'veh-t', type: 'symbol', source: 'veh', layout: { 'text-field': ['get', 'name'], 'text-size': 12.5, 'text-font': ['Noto Sans Bold'], 'text-anchor': 'left', 'text-offset': [0.95, 0], 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#fff', 'text-halo-color': '#1A1238', 'text-halo-width': 2.2 } });
    map.on('movestart', e => { if (e.originalEvent) focusMap(true); });
    // ruime tikzone: je hoeft een bus of halte niet precies te raken
    map.on('click', e => {
      const r = 20, box = [[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]];
      const v = map.queryRenderedFeatures(box, { layers: ['veh-c'] })[0];
      if (v) return openRide(v.properties.tripId);
      const st = map.queryRenderedFeatures(box, { layers: ['stops'] })[0];
      if (st) { state.stopsOpen = true; setSheet('half'); loadBoard({ id: st.properties.ids, ids: st.properties.ids.split('|'), label: st.properties.name }); return render(); }
      if (!state.from && !state.trip && !state.stopsOpen && state.gpsDenied && e.lngLat) {   // zonder gps: wijs zelf aan waar je bent
        state.from = { label: 'Gekozen punt', place: `${e.lngLat.lat},${e.lngLat.lng}`, lat: e.lngLat.lat, lon: e.lngLat.lng };
        $('#from').value = 'Gekozen punt'; focusMap(false); return endpointsChanged();
      }
      focusMap(!document.body.classList.contains('map-focus'));   // tik op de kaart: paneel omlaag, nog een tik: weer omhoog
    });
    ['veh-c', 'stops'].forEach(l => { map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; }); map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; }); });
    let t; map.on('moveend', () => { clearTimeout(t); t = setTimeout(() => { fetchVehicles(); fetchStops(); fetchGps(); }, 350); });
    mapReady = true; mapKey = ''; drawMap(); drawMe(); fetchVehicles();
  });
}
function decodePolyline(str, precision) {
  const f = 10 ** (precision || 5), out = [];
  let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const k of [0, 1]) {
      let shift = 0, res = 0, b;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while (b >= 32);
      const d = res & 1 ? ~(res >> 1) : res >> 1;
      if (k === 0) lat += d; else lon += d;
    }
    out.push([lon / f, lat / f]);   // GeoJSON-volgorde
  }
  return out;
}
function drawMap() {
  if (!mapReady) return;
  const ride = state.ride?.leg;
  const itin = ride ? { legs: [ride] } : state.trip ? state.trip.itin : (!state.stopsOpen && state.results[state.sel]) || null;
  const key = (ride ? 'r' : '') + (itin ? itin.legs.map(l => (l.tripId || l.mode) + (l.cancelled ? 'x' : '')).join('|') : `${state.from?.place}>${state.to?.place}`);
  if (key === mapKey) return;
  mapKey = key;
  const lines = [], dots = [], all = [];
  const dot = (p, big, color, fill, label) => dots.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { r: big ? 8 : label ? 7 : 5, color: color || DEEP, fill: fill || '#fff', label: label || '' } });
  if (itin) {
    itin.legs.forEach(l => {
      const line = l.legGeometry?.points ? decodePolyline(l.legGeometry.points, l.legGeometry.precision) : [[l.from.lon, l.from.lat], [l.to.lon, l.to.lat]];
      all.push(...line);
      const transit = isTransit(l);
      lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: { kind: transit ? 'transit' : 'walk', color: l.cancelled ? '#D12C3F' : (hex(l.routeColor) || BRAND), opacity: l.cancelled ? .45 : 1 } });
    });
    itin.legs.forEach((l, i) => { if (i > 0 && isTransit(l)) dot(l.from, false, null, '#C8F53C', `Overstap ${nice(l.from.name)}`); });
    dot(itin.legs[0].from, true); dot(itin.legs[itin.legs.length - 1].to, true, BRAND, '#C8F53C');
  } else {
    if (state.from?.lat) { all.push([state.from.lon, state.from.lat]); dot(state.from, true); }
    if (state.to?.lat) { all.push([state.to.lon, state.to.lat]); dot(state.to, true, BRAND, '#C8F53C'); }
  }
  map.getSource('route').setData(fc(lines));
  map.getSource('pts').setData(fc(dots));
  if (!all.length) return;
  if (all.length === 1) return map.flyTo({ center: all[0], zoom: 15, pitch: mapPitch });
  if (ride) {
    const p = ridePosition(ride, Date.now());
    if (p) return map.easeTo({ center: p, zoom: 15, pitch: 0, bearing: 0, offset: [0, -Math.min($('#sheet').offsetHeight, innerHeight * 0.55) / 2 + 20], duration: 900 });
  }
  if (state.trip?.started && !state.ride) return liveCamera();
  const b = all.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(all[0], all[0]));
  const sheetH = Math.min($('#sheet').offsetHeight, innerHeight * 0.55);
  map.fitBounds(b, { padding: { top: $('#plan-form').hidden ? 70 : 232, bottom: sheetH + 24, left: 36, right: 36 }, maxZoom: 15.5, pitch: mapPitch, bearing: 0, duration: 900 });
}
/* Live-beeld zoals bij een taxi-app: je instaphalte en het voertuig dat eraan komt samen in beeld. */
function liveCamera() {
  const trip = state.trip; if (!mapReady || !trip) return;
  const L = trip.itin.legs, now = Date.now(), pts = [];
  const cur = L.find(l => ms(l.endTime) > now) || L[L.length - 1];
  const near = (p, q) => distM({ lat: p[1], lon: p[0] }, { lat: q[1], lon: q[0] }) < 15000;
  if (isTransit(cur) && ms(cur.startTime) <= now) {
    pts.push(ridePosition(cur, now) || [cur.from.lon, cur.from.lat], [cur.to.lon, cur.to.lat]);
  } else {
    const nt = L.find(l => isTransit(l) && ms(l.startTime) > now);
    const stop = nt ? [nt.from.lon, nt.from.lat] : [cur.to.lon, cur.to.lat];
    pts.push(stop);
    if (state.gps && now - state.gps.at < 120000 && near([state.gps.lon, state.gps.lat], stop)) pts.push([state.gps.lon, state.gps.lat]);
    else if (!isTransit(cur)) pts.push([cur.from.lon, cur.from.lat]);
    if (nt && nt.full && now >= ms(nt.full[0].departure || nt.full[0].arrival)) { const v = ridePosition(nt, now); if (v && near(v, stop)) pts.push(v); }
  }
  const sheetH = Math.min($('#sheet').offsetHeight, innerHeight * 0.55);
  if (pts.length < 2) return map.easeTo({ center: pts[0], zoom: 15, pitch: 0, bearing: 0, offset: [0, -sheetH / 2 + 20], duration: 900 });
  const b = pts.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(pts[0], pts[0]));
  map.fitBounds(b, { padding: { top: 90, bottom: sheetH + 50, left: 60, right: 70 }, maxZoom: 15.5, pitch: 0, bearing: 0, duration: 900 });
}
function drawMe() {
  if (!mapReady || !state.gps) return;
  const ll = [state.gps.lon, state.gps.lat];
  if (meMarker) return meMarker.setLngLat(ll);
  const el = document.createElement('div'); el.className = 'me-dot';
  meMarker = new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(map);
}

/* Live voertuigen: ritsegmenten met actuele tijden; de positie wordt daaruit berekend. */
let vehSegs = [], vehFetched = 0, netFilter = '';
async function fetchVehicles() {
  if (!mapReady) return;
  if (!state.vehOn || map.getZoom() < 10.5 || document.hidden) { vehSegs = []; if (!document.hidden) map.getSource('net').setData(fc([])); return paintVehicles(); }
  const b = map.getBounds(), now = Date.now();
  try {
    const d = await api('/v5/map/trips', { min: `${b.getNorth()},${b.getWest()}`, max: `${b.getSouth()},${b.getEast()}`, startTime: new Date(now).toISOString(), endTime: new Date(now + 20 * 60000).toISOString(), zoom: Math.round(map.getZoom()) });
    vehSegs = d.map(sg => {
      const line = decodePolyline(sg.polyline, 5), cum = [0];
      for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot((line[i][0] - line[i - 1][0]) * 0.61, line[i][1] - line[i - 1][1]));
      return { id: sg.trips[0].tripId, name: sg.trips[0].displayName || '', mode: sg.mode, color: hex(sg.routeColor), dep: ms(sg.departure), arr: ms(sg.arrival), line, cum };
    });
    vehFetched = now;
    const seen = new Set(), net = [];
    d.forEach((sg, i) => {
      const nm = sg.trips[0].displayName || '';
      if (isRail(sg.mode) || seen.has(nm + sg.polyline)) return;   // spoor staat al op de kaart
      seen.add(nm + sg.polyline);
      net.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: vehSegs[i].line }, properties: { color: hex(sg.routeColor) || BRAND, name: nm } });
    });
    map.getSource('net').setData(fc(net));
  } catch { /* volgende poging bij verplaatsen */ }
  paintVehicles();
}
function along(sg, f) {
  if (sg.line.length < 2) return sg.line[0];
  const total = sg.cum[sg.cum.length - 1], target = total * Math.max(0, Math.min(1, f));
  let i = 1; while (i < sg.cum.length - 1 && sg.cum[i] < target) i++;
  const span = sg.cum[i] - sg.cum[i - 1] || 1, k = (target - sg.cum[i - 1]) / span;
  return [sg.line[i - 1][0] + (sg.line[i][0] - sg.line[i - 1][0]) * k, sg.line[i - 1][1] + (sg.line[i][1] - sg.line[i - 1][1]) * k];
}
const TRAIN_ABBR = [[/intercity direct|^icd/i, 'ICD'], [/intercity|^ic\b/i, 'IC'], [/sprinter|^spr/i, 'SPR'], [/stoptrein|^st\b/i, 'ST'], [/sneltrein/i, 'SNEL'], [/eurostar|thalys/i, 'EST'], [/^ice/i, 'ICE'], [/nightjet/i, 'NJ'], [/^re\b|regional/i, 'RE'], [/^rb\b/i, 'RB'], [/stopbus|bus/i, 'BUS']];
function shortName(name, mode) {
  if (isRail(mode)) {
    const hit = TRAIN_ABBR.find(([re]) => re.test(name));
    if (hit) return hit[1];
    return (name.split(' ')[0] || 'TR').slice(0, 4).toUpperCase();
  }
  return name.length <= 5 ? name : name.split(' ')[0].slice(0, 5);
}
/* De route van een rit als lijn, met voor elke halte de afstand langs die lijn. */
const pathCache = new WeakMap();
function legPath(leg) {
  if (pathCache.has(leg)) return pathCache.get(leg);
  let res = null;
  const g = leg.fullGeom || (leg.full ? null : leg.legGeometry);
  const st = leg.full || [leg.from, ...(leg.intermediateStops || []), leg.to];
  if (g && g.points && st.length > 1) {
    const line = decodePolyline(g.points, g.precision), cum = [0];
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot((line[i][0] - line[i - 1][0]) * 0.61, line[i][1] - line[i - 1][1]));
    let j = 0; const at = [];
    st.forEach(s => {
      let best = j, bd = Infinity;
      for (let k = j; k < line.length; k++) { const d = ((line[k][0] - s.lon) * 0.61) ** 2 + (line[k][1] - s.lat) ** 2; if (d < bd) { bd = d; best = k; } }
      j = best; at.push(cum[best]);
    });
    if (line.length > 1) res = { line, cum, at };
  }
  pathCache.set(leg, res);
  return res;
}
function pointAt(path, dist) {
  const { line, cum } = path;
  let i = 1; while (i < cum.length - 1 && cum[i] < dist) i++;
  const span = cum[i] - cum[i - 1] || 1, k = Math.max(0, Math.min(1, (dist - cum[i - 1]) / span));
  return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * k, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * k];
}
function ridePosition(leg, now) {
  const st = leg.full || [leg.from, ...(leg.intermediateStops || []), leg.to], path = legPath(leg);
  for (let i = 0; i < st.length - 1; i++) {
    const d = ms(st[i].departure || st[i].arrival), a = ms(st[i + 1].arrival || st[i + 1].departure);
    if (now < d) return [st[i].lon, st[i].lat];
    if (now <= a) {
      const k = (now - d) / (a - d || 1);
      if (path && path.at.length === st.length) return pointAt(path, path.at[i] + (path.at[i + 1] - path.at[i]) * k);   // langs de echte route
      return [st[i].lon + (st[i + 1].lon - st[i].lon) * k, st[i].lat + (st[i + 1].lat - st[i].lat) * k];
    }
  }
  return null;
}
/* Afstand in meters van een punt tot een lijn (per lijnstuk, niet alleen de hoekpunten). */
function distToLine(line, p) {
  let best = Infinity; const kx = 111320 * Math.cos(p.lat * Math.PI / 180), ky = 110540;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - p.lon) * kx, ay = (line[i - 1][1] - p.lat) * ky, bx = (line[i][0] - p.lon) * kx, by = (line[i][1] - p.lat) * ky;
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(ax + t * dx, ay + t * dy); if (d < best) best = d;
  }
  return best;
}
/* Echte gps-posities van bussen, trams en metro's (via de tussenlaag). Treinen komen van NS. */
let gpsVeh = new Map(), gpsFetched = 0;
const shownPos = new Map();
const tripTail = id => String(id).split('_').slice(2).join('_').replace(/^nl-OpenOV_/, '');
async function fetchGps() {
  if (!mapReady || document.hidden) return;
  gpsFetched = Date.now();
  const b = map.getBounds();
  let n = b.getNorth(), s = b.getSouth(), w = b.getWest(), e = b.getEast();
  const padLat = (n - s) * 0.5, padLon = (e - w) * 0.5; n += padLat; s -= padLat; w -= padLon; e += padLon;
  // je eigen bus kan nog buiten beeld rijden: neem zijn hele rit mee
  if (state.trip) state.trip.itin.legs.forEach(l => (isTransit(l) && !isRail(l.mode) && l.full || []).forEach(p => { n = Math.max(n, p.lat); s = Math.min(s, p.lat); w = Math.min(w, p.lon); e = Math.max(e, p.lon); }));
  if (n - s > 1.2 || e - w > 2) return;   // te ver uitgezoomd
  try {
    const r = await fetch(`${PROXY}/voertuigen?min=${n.toFixed(4)},${w.toFixed(4)}&max=${s.toFixed(4)},${e.toFixed(4)}`);
    if (!r.ok) return;
    const now = Date.now() / 1000;
    gpsVeh = new Map((await r.json()).filter(v => now - v.ts < 240).map(v => [v.t, v]));
  } catch { /* tussenlaag onbereikbaar: de berekende positie blijft */ }
}
const gpsFor = id => { const v = gpsVeh.get(tripTail(id)); return v ? [v.lo, v.la] : null; };
// laat een voertuig naar zijn nieuwe positie glijden in plaats van te verspringen
function glide(id, target) {
  const cur = shownPos.get(id);
  if (!cur || Math.abs(cur[0] - target[0]) + Math.abs(cur[1] - target[1]) > 0.02) { shownPos.set(id, target.slice()); return target; }
  cur[0] += (target[0] - cur[0]) * 0.1; cur[1] += (target[1] - cur[1]) * 0.1;
  return cur.slice();
}
function paintVehicles() {
  if (!mapReady) return;
  const now = Date.now(), best = new Map();
  const selId = state.ride?.leg?.tripId;
  // met een gekozen reis: alleen jouw eigen bus en trein, tenzij je alles aanzet
  const itin = state.ride ? null : state.trip ? state.trip.itin : (!state.stopsOpen && state.results[state.sel]) || null;
  const mine = itin ? itin.legs.filter(isTransit) : [];
  const only = itin && !state.showAll ? new Set(mine.map(l => l.tripId)) : null;
  const tracked = new Set(mine.filter(l => l.full).map(l => l.tripId));
  if (map.getLayer('net') && (map.getLayoutProperty('net', 'visibility') === 'none') !== !!only) map.setLayoutProperty('net', 'visibility', only ? 'none' : 'visible');
  const lf = only || state.ride ? null : state.lineFilter;
  if (map.getLayer('net') && netFilter !== (lf ? lf.short : '')) { netFilter = lf ? lf.short : ''; map.setFilter('net', lf ? ['==', ['get', 'name'], lf.short] : null); }
  vehSegs.forEach(sg => {
    if (sg.id === selId || !sg.line.length || tracked.has(sg.id) || (only && !only.has(sg.id)) || (lf && sg.name !== lf.short)) return;
    const cur = best.get(sg.id), active = sg.dep <= now && now <= sg.arr;
    const score = active ? 0 : now < sg.dep ? sg.dep - now : now - sg.arr + 1e9;
    if (!cur || score < cur.score) best.set(sg.id, { sg, score });
  });
  const feats = [];
  best.forEach(({ sg, score }) => {
    if (score > 120000) return;   // rijdt nu, of vertrekt binnen twee minuten
    const f = (now - sg.dep) / (sg.arr - sg.dep || 1);
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: glide(sg.id, (!isRail(sg.mode) && gpsFor(sg.id)) || along(sg, f)) }, properties: { tripId: sg.id, name: shortName(sg.name, sg.mode), color: sg.color || (isRail(sg.mode) ? DEEP : BRAND), sel: false } });
  });
  mine.filter(l => l.full && !l.cancelled).forEach(l => {
    const p0 = ridePosition(l, now), g = !isRail(l.mode) && gpsFor(l.tripId), p = g || p0 ? glide(l.tripId, g || p0) : null;
    if (p && now > ms(l.full[0].departure || l.full[0].arrival) - 120000) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { tripId: l.tripId, name: shortName(l.displayName || l.routeShortName || '', l.mode), color: hex(l.routeColor) || (isRail(l.mode) ? DEEP : BRAND), sel: !!only } });
  });
  if (state.ride?.leg) {
    const l = state.ride.leg, p0 = ridePosition(l, now), g = !isRail(l.mode) && gpsFor(l.tripId), p = g || p0 ? glide(l.tripId, g || p0) : null;
    if (p) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { tripId: l.tripId, name: shortName(l.displayName || l.routeShortName || '', l.mode), color: hex(l.routeColor) || (isRail(l.mode) ? DEEP : BRAND), sel: true } });
  }
  map.getSource('veh').setData(fc(feats));
}
/* Haltes met dezelfde naam vlak bij elkaar worden één punt: perrons, busplatforms en beide rijrichtingen. */
function groupStops(list) {
  const norm = n => n.replace(/^[^,]+,\s*/, '').trim().toLowerCase();
  const groups = [];
  list.forEach(st => {
    const key = norm(st.name);
    let g = groups.find(x => x.key === key && distM(x, st) < 500);
    if (!g) { g = { key, lat: st.lat, lon: st.lon, n: 0, sLat: 0, sLon: 0, ids: new Set(), name: st.name, rail: false }; groups.push(g); }
    g.n++; g.sLat += st.lat; g.sLon += st.lon; g.ids.add(st.parentId || st.stopId);
    if (!g.rail && (st.modes || []).some(isRail)) { g.rail = true; g.name = st.name; g.rLat = st.lat; g.rLon = st.lon; }
  });
  return groups.map(g => ({ name: g.name, rail: g.rail, lat: g.rail ? g.rLat : g.sLat / g.n, lon: g.rail ? g.rLon : g.sLon / g.n, ids: [...g.ids].slice(0, 14) }));
}
async function fetchStops() {
  if (!mapReady) return;
  if (map.getZoom() < 14) return map.getSource('stops').setData(fc([]));
  const b = map.getBounds();
  try {
    const d = await api('/v1/map/stops', { min: `${b.getNorth()},${b.getWest()}`, max: `${b.getSouth()},${b.getEast()}` });
    map.getSource('stops').setData(fc(groupStops(d).map(g => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [g.lon, g.lat] }, properties: { ids: g.ids.join('|'), name: g.name, rail: g.rail } }))));
  } catch { /* haltes blijven zoals ze waren */ }
}
// vloeiend: voertuigen schuiven elke beeldverversing een stukje op in plaats van eens per seconde te verspringen
let lastPaint = 0;
(function loop(t) {
  if (!document.hidden && t - lastPaint > 40 && (vehSegs.length || state.ride?.leg || state.trip)) { lastPaint = t; paintVehicles(); }
  requestAnimationFrame(loop);
})(0);
setInterval(() => { if (state.vehOn && Date.now() - vehFetched > 90000) fetchVehicles(); }, 15000);
setInterval(() => { if (Date.now() - gpsFetched > 18000) fetchGps(); }, 5000);

/* ---------- zoeken met suggesties ---------- */
function geoLabel(g) {
  const area = (g.areas || []).find(a => a.default) || (g.areas || []).find(a => a.adminLevel >= 8);
  const sub = area && !g.name.includes(area.name) ? area.name : '';
  return { name: g.name, sub };
}
function addRecent(pick) {
  state.recent = [pick, ...state.recent.filter(r => r.place !== pick.place)].slice(0, 6);
  store.set('omreis.recent', state.recent);
}
function autocomplete(input, list, { onPick, stopsOnly, gps }) {
  let timer, seq = 0, items = [];
  const close = () => { list.hidden = true; };
  const show = () => {
    list.innerHTML = items.map((g, i) => {
      if (g._gps) return `<li data-i="${i}">${svg('locate')}<span>Mijn locatie</span></li>`;
      const n = g._pick ? { name: g.label, sub: g.sub || '' } : geoLabel(g);
      const stop = g._pick ? g.stop : g.type === 'STOP';
      return `<li data-i="${i}">${svg(g._pick ? 'clock' : stop ? 'stop' : 'pin')}<span>${esc(n.name)}<small>${esc(n.sub)}</small></span></li>`;
    }).join('');
    list.hidden = !items.length;
  };
  input.addEventListener('focus', () => {
    if (input.value.trim()) return;
    items = [...(gps ? [{ _gps: true }] : []), ...state.recent.filter(r => !stopsOnly || r.stop).map(r => ({ ...r, _pick: true }))];
    show();
  });
  input.addEventListener('input', () => {
    onPick(null);
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const p = { text: q, language: 'nl' };
        if (state.gps) p.place = `${state.gps.lat},${state.gps.lon}`;
        if (stopsOnly) p.type = 'STOP';
        let res = await api('/v1/geocode', p);
        if (my !== seq) return;
        const TOWN = /^(city|town|village|hamlet|suburb|neighbourhood|quarter|borough|municipality)$/;
        res = res.filter(g => g.country === 'NL' && (g.type === 'STOP' || (!stopsOnly && (g.type === 'ADDRESS' || TOWN.test(g.category || '')))));
        items = res.slice(0, 7);
        if (items.length) show(); else { list.innerHTML = '<li><small>Niets gevonden</small></li>'; list.hidden = false; }
      } catch { close(); }
    }, 250);
  });
  list.addEventListener('pointerdown', e => {
    const li = e.target.closest('li[data-i]'); if (!li) return;
    e.preventDefault();
    const g = items[+li.dataset.i];
    close(); input.blur();
    if (g._gps) return useMyLocation(false);
    let pick;
    if (g._pick) { pick = { ...g }; delete pick._pick; }
    else { const { name, sub } = geoLabel(g); pick = { label: name, sub, place: g.type === 'STOP' ? g.id : `${g.lat},${g.lon}`, id: g.id, lat: g.lat, lon: g.lon, stop: g.type === 'STOP' }; }
    input.value = pick.label;
    addRecent(pick);
    onPick(pick);
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}

/* ---------- opties zoeken (blijft live verversen) ---------- */
function setMsg(text, err) {
  const m = $('#plan-msg');
  m.hidden = !text; m.className = 'msg' + (err ? ' err' : ''); m.innerHTML = text || '';
}
function endpointsChanged() {
  state.results = []; state.sel = 0; state.paged = false; state.cursors = {};
  // alleen een bestemming is genoeg: vertrekpunt is waar je nu bent
  if (state.to && !state.from && !state.showFrom && !state.gpsDenied && !state.locating && !state.pickFor) { renderPlan(); return useMyLocation(false); }
  if (state.from && state.to) searchPlan(); else { renderPlan(); drawMap(); }
}
async function searchPlan({ silent, cursor } = {}) {
  if (!state.from || !state.to || state.searching) return;
  state.searching = true; state.lastSearch = Date.now();
  if (!silent) { setMsg('<span class="spinner"></span>Je reis zoeken…'); if (!cursor) { $('#view-plan').insertBefore($('.whenbox'), $('#plan-msg')); $('#results').innerHTML = ''; } }
  const from = state.from, to = state.to;
  try {
    const when = $('#when').value;
    const data = await api('/v5/plan', {
      fromPlace: from.place, toPlace: to.place,
      time: when ? new Date(when).toISOString() : new Date().toISOString(),
      arriveBy: $('#when-mode').value === 'arr' ? 'true' : null,
      pageCursor: cursor, numItineraries: 8, additionalTransferTime: 2
    });
    if (from !== state.from || to !== state.to || state.trip) return;
    const keepId = silent && state.results[state.sel]?.legs.map(l => l.tripId).join();
    state.results = (data.itineraries || []).sort((a, b) => rank(a) - rank(b)).slice(0, 6);
    state.cursors = { prev: data.previousPageCursor, next: data.nextPageCursor };
    state.paged = !!cursor;
    const k = keepId ? state.results.findIndex(it => it.legs.map(l => l.tripId).join() === keepId) : -1;
    state.sel = k >= 0 ? k : 0;
    setMsg(state.results.length ? '' : 'Geen reis gevonden. Probeer een ander tijdstip of een halte in de buurt.', !state.results.length);
    if (!silent) setSheet('half');
  } catch (err) {
    if (!silent) setMsg(`Zoeken lukte niet (${esc(err.message)}). Controleer je verbinding.`, true);
  } finally { state.searching = false; }
  renderPlan(); drawMap();
}
const PLACE_NAME = { home: 'Thuis', work: 'Werk' };
const savedIndex = () => state.from && state.to ? state.saved.findIndex(t => t.to.place === state.to.place && (t.from.gps ? state.from.label === 'Mijn locatie' : t.from.place === state.from.place)) : -1;
function shortcutsHtml() {
  const P = state.places, ed = state.editing;
  const chips = ['home', 'work'].map(k => `<span class="quick-item"><button class="btn${P[k] ? '' : ' unset'}" data-action="place" data-k="${k}">${svg(k)}${PLACE_NAME[k]}${P[k] ? '' : '<small>instellen</small>'}</button>${ed && P[k] ? `<button class="icon-btn" data-action="delplace" data-k="${k}" aria-label="${PLACE_NAME[k]} wissen">${svg('close')}</button>` : ''}</span>`).join('');
  const rows = state.saved.map((t, i) => `<div class="saved-row">
      <button class="go" data-action="usesaved" data-i="${i}">${esc(t.from.label)}<span class="arrow">→</span>${esc(t.to.label)}</button>
      ${ed ? `<button class="icon-btn" data-action="delsaved" data-i="${i}" aria-label="Verwijder">${svg('close')}</button>`
        : t.from.gps ? '' : `<button class="icon-btn" data-action="usesaved" data-i="${i}" data-rev="1" aria-label="Terugreis" title="Terugreis">${svg('swap')}</button>`}
    </div>`).join('');
  const any = state.saved.length || P.home || P.work;
  $('#quick').innerHTML = chips;
  return `${rows ? `<h2>Opgeslagen reizen</h2>${rows}` : ''}${linesHtml(ed)}${any || state.lines.length ? `<button class="btn-text" data-action="edit">${ed ? 'Klaar' : 'Aanpassen'}</button>` : ''}<div class="ver">versie ${VERSION}</div>`;
}
function setEndpoints(from, to) {
  state.to = to; $('#to').value = to?.label || '';
  if (from) { state.from = from; $('#from').value = from.label; endpointsChanged(); }
  else if (state.from) endpointsChanged();
  else useMyLocation(false);   // vult "Van" en zoekt daarna vanzelf
}
/* De reis in gewone zinnen: wat moet je doen, in welke volgorde. */
function sayLines(it) {
  const L = it.legs, tr = L.filter(isTransit), out = [];
  const first = L[0], last = L[L.length - 1];
  if (!tr.length) out.push(['walk', `Loop ${dur(it.duration)} naar je bestemming`]);
  else if (!isTransit(first) && first.duration >= 60) out.push(['walk', `Loop ${dur(first.duration)} naar halte ${esc(nice(tr[0].from.name))}`]);
  tr.forEach((l, i) => {
    const ic = MODE_IC[l.mode] || (isRail(l.mode) ? 'train' : 'bus'), plat = l.from.track ? `, perron ${esc(l.from.track)}` : '';
    out.push([ic, i
      ? `Op ${esc(nice(l.from.name))} overstappen op <strong>${esc(theRide(l))}</strong> richting ${esc(nice(l.headsign || l.to.name))} · ${hhmm(l.startTime)}${plat}`
      : `<strong>${esc(rideName(l, true))}</strong> richting ${esc(nice(l.headsign || l.to.name))} · ${hhmm(l.startTime)}${plat}`]);
  });
  if (tr.length) out.push(['pin', `Uitstappen op ${esc(nice(tr[tr.length - 1].to.name))}${!isTransit(last) && last !== first && last.duration >= 120 ? `, daarna ${dur(last.duration)} lopen` : ''}`]);
  return out.map(([ic, t]) => `<li>${svg(ic)}<span>${t}</span></li>`).join('');
}
function renderPlan() {
  const has = state.results.length > 0;
  $('#shortcuts').hidden = has;
  $('#shortcuts').innerHTML = shortcutsHtml();
  const sb = $('#save-trip'); sb.hidden = !has; sb.classList.toggle('on', savedIndex() >= 0);
  const live = has && !$('#when').value && !state.paged;
  $('#plan-refresh').hidden = true;
  const w = $('#when').value, arr = $('#when-mode').value === 'arr';
  $('#when-now').hidden = !w;
  $('#when-label').textContent = w ? `${arr ? 'Aankomst' : 'Vertrek'} ${new Date(w).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : (arr ? 'Aankomst: kies tijd' : 'Nu vertrekken');
  $('.whenbox').hidden = !has;
  $('#plan-title').textContent = has ? 'Jouw reis' : 'Waar wil je heen?';
  $('#plan-form').classList.toggle('simple', !state.showFrom && (!state.from || state.from.label === 'Mijn locatie'));
  if (state.pickFor) setMsg(`Typ hierboven het adres van ${state.pickFor === 'home' ? 'thuis' : 'je werk'}.`);
  else if (!state.to) setMsg('Typ hierboven je bestemming. Je ziet meteen welke bus of trein je moet nemen.');
  else if (state.locating) setMsg('<span class="spinner"></span>Je locatie bepalen…');
  else if (!state.from && state.gpsDenied) setMsg(`${{ 1: 'Locatie staat uit voor Omreis. Zet hem aan bij de instellingen van deze site in je browser.', 2: 'Je toestel geeft geen locatie door. Staat Locatie aan in de instellingen van je telefoon of computer?', 3: 'Je locatie vinden duurt te lang. Ga bij een raam staan of naar buiten.' }[state.gpsError] || 'Deze browser kan je locatie niet doorgeven.'} Je kunt ook op de kaart tikken waar je bent, of hierboven typen waar je vertrekt. <button class="btn-text" data-action="retryloc">Probeer opnieuw</button>`, true);
  else if (!state.from) setMsg('Typ hierboven waar je vertrekt.');
  $('#view-plan').insertBefore($('.whenbox'), $('#plan-msg'));
  if (!has) { $('#results').innerHTML = ''; return; }
  const it = state.results[state.sel], n = state.results.length - 1;
  $('#results').innerHTML = `<div class="bestcard">
      <div class="k">${state.sel === 0 && live ? 'Snelste reis' : 'Jouw keuze'}${it.legs.some(l => l.cancelled) ? '<span class="pill">rijdt niet</span>' : ''}</div>
      <div class="big"><span><small>Vertrek</small><b class="num">${hhmm(it.startTime)}</b></span><i>→</i><span><small>Je bent er om</small><b class="num">${hhmm(it.endTime)}</b></span></div>
      <div class="meta">${dur(it.duration)} · ${transfersText(it.transfers)}${walkMin(it) ? ` · ${walkMin(it)} min lopen` : ''}</div>
      <ul class="say">${sayLines(it)}</ul>
      <button class="btn-primary" data-action="startbest">Start reis</button>
    </div>
    <details class="others"${state.othersOpen ? ' open' : ''}><summary>${n > 0 ? `Andere opties (${n})` : 'Andere tijd'}</summary>
      ${state.results.map((x, i) => itinCard(x, i, i === state.sel ? 'Gekozen' : 'Kies', 'select', i === state.sel, i === 0 && live ? 'Snelste' : '')).join('')}
      <div class="pager"><button class="btn-text" data-action="page" data-dir="prev"${state.cursors.prev ? '' : ' disabled'}>Eerder</button><button class="btn-text" data-action="page" data-dir="next"${state.cursors.next ? '' : ' disabled'}>Later</button></div>
    </details>`;
  const wb = $('.whenbox'); $('.others').insertBefore(wb, $('.others .itin') || $('.others .pager'));   // tijd kiezen hoort bij de andere opties
}
function itinCard(it, i, cta, action, selected, label) {
  const legs = it.legs.filter(l => l.mode !== 'WALK' || l.duration >= 120);
  const first = it.legs.find(isTransit);
  const cancelled = it.legs.some(l => l.cancelled);
  const sub = first ? `${hhmm(first.startTime)}${delayHtml(first.startTime, first.scheduledStartTime)} vanaf ${esc(first.from.name)}${platform(first.from)}` : 'Alleen lopen';
  return `<button type="button" class="itin${selected ? ' sel' : ''}" data-action="${action}" data-i="${i}">
    <span class="itin-top"><span class="itin-time num">${hhmm(it.startTime)}<i>–</i>${hhmm(it.endTime)}${cancelled ? '<span class="pill">rijdt niet</span>' : ''}</span><span class="itin-dur">${dur(it.duration)} · ${transfersText(it.transfers)}${walkMin(it) ? ` · ${walkMin(it)} min lopen` : ''}</span></span>
    <span class="chips">${legs.map(chip).join('<span class="sep"></span>')}</span>
    <span class="itin-foot"><span>${label ? `<b class="fast">${label}</b>` : ''}${sub}</span><span class="cta">${cta}</span></span>
  </button>`;
}

/* ---------- reis bekijken en volgen ---------- */
function openTrip(itin, label) {
  const prev = state.trip;
  state.trip = { itin, label: label || prev?.label || '', origEnd: itin.endTime, sim: null, updated: Date.now(), started: prev?.started || false };
  state.alts = null; state.altsFor = ''; state.problemKey = ''; state.best = null; lastBest = 0;
  store.set('omreis.trip', state.trip);
  evaluate(); setSheet('half'); render();
  refreshTrip();
  $('#sheet-body').scrollTop = 0;
}
let lastBest = 0;
async function checkBest() {
  const trip = state.trip;
  if (!trip?.started || state.problemKey) { state.best = null; return; }
  const o = currentOrigin(); if (!o) return;
  lastBest = Date.now();
  try {
    const data = await api('/v5/plan', { fromPlace: o.place, toPlace: placeOf(destOf(trip.itin)), time: new Date(Math.max(o.time, Date.now())).toISOString(), numItineraries: 6 });
    if (state.trip !== trip) return;
    const mine = new Set(trip.itin.legs.filter(isTransit).map(l => l.tripId));
    const cand = (data.itineraries || []).filter(it => !it.legs.some(l => l.cancelled)).sort((a, b) => rank(a) - rank(b))[0];
    if (!cand) state.best = null;
    else {
      const same = cand.legs.filter(isTransit).every(l => mine.has(l.tripId));
      const gain = mins(ms(trip.itin.endTime) - ms(cand.endTime)), better = mins(rank(trip.itin, Date.now()) - rank(cand));
      const fewer = trip.itin.legs.filter(l => isTransit(l) && ms(l.endTime) > Date.now()).length - cand.legs.filter(isTransit).length;
      const why = gain >= 2 ? `${gain} min eerder binnen` : fewer > 0 ? `${fewer === 1 ? 'een overstap' : `${fewer} overstappen`} minder` : 'rustiger overstap';
      state.best = !same && better >= 3 ? { itin: cand, gain, why, from: o.name } : { current: true };
      const first = cand.legs.find(isTransit), bestKey = cand.legs.filter(isTransit).map(l => l.tripId).join();
      if (state.best.itin && first && trip.bestKey !== bestKey) {
        trip.bestKey = bestKey;
        notify(`${state.best.why} met ${theRide(first)} van ${hhmm(first.startTime)} vanaf ${nice(first.from.name)}.`, 'Betere optie', 'omreis-sneller');
      }
    }
  } catch { /* volgende ronde opnieuw */ }
  if (!state.modal) render();
}
function beginTrip() {
  state.trip.started = true; state.best = null; checkBest();
  store.set('omreis.trip', state.trip);
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  watchGps(); setSheet('peek'); render();
  const fx = $('#startfx'); fx.hidden = false; setTimeout(() => { fx.hidden = true; }, 1600);
  mapKey = ''; drawMap();
}
function closeTrip() {
  state.trip = null; state.best = null; state.alts = null; state.problems = []; state.problemKey = ''; state.modal = null;
  localStorage.removeItem('omreis.trip');
  render();
  if (mapReady) map.easeTo({ pitch: mapPitch, bearing: 0, duration: 600 });
  if (state.from && state.to) searchPlan({ silent: state.results.length > 0 });
}
function recalc(itin) {
  const L = itin.legs;
  itin.startTime = L[0].startTime; itin.endTime = L[L.length - 1].endTime;
  itin.duration = (ms(itin.endTime) - ms(itin.startTime)) / 1000;
  itin.transfers = Math.max(0, L.filter(isTransit).length - 1);
}

async function refreshTrip() {
  const trip = state.trip; if (!trip || !navigator.onLine) return;
  const now = Date.now(), changes = [];
  await Promise.all(trip.itin.legs.map(async leg => {
    if (!isTransit(leg) || ms(leg.endTime) < now - 10 * 60000) return;
    try {
      const t = await api('/v5/trip', { tripId: leg.tripId });
      const tl = t.legs && t.legs[0]; if (!tl) return;
      const stops = [tl.from, ...(tl.intermediateStops || []), tl.to];
      const a = stops.findIndex(s => s.stopId === leg.from.stopId);
      const b = stops.findIndex((s, i) => i > a && s.stopId === leg.to.stopId);
      if (a < 0 || b < 0) return;
      const oldTrack = leg.from.track;
      leg.from = { ...leg.from, ...stops[a] };
      leg.to = { ...leg.to, ...stops[b] };
      leg.intermediateStops = stops.slice(a + 1, b);
      leg.fullFrom = a;
      leg.fullGeom = tl.legGeometry && tl.legGeometry.points ? { points: tl.legGeometry.points, precision: tl.legGeometry.precision } : null; pathCache.delete(leg);
      leg.full = stops.map(x => ({ name: x.name, lat: x.lat, lon: x.lon, arrival: x.arrival, departure: x.departure }));   // hele rit, om het voertuig ook vóór jouw halte te volgen
      leg.startTime = stops[a].departure || leg.startTime;
      leg.endTime = stops[b].arrival || leg.endTime;
      leg.realTime = tl.realTime;
      leg.cancelled = !!(tl.cancelled || stops[a].cancelled || stops[b].cancelled);
      if (trip.started && oldTrack && leg.from.track && oldTrack !== leg.from.track && ms(leg.startTime) > now)
        changes.push(`${legName(leg)} van ${hhmm(leg.startTime)} vertrekt van perron ${leg.from.track} in plaats van ${oldTrack}.`);
    } catch { /* tijdelijk geen update voor deze rit */ }
  }));
  if (state.trip !== trip) return;
  const L = trip.itin.legs;   // looptijden schuiven mee met de aansluitende ritten
  L.forEach((leg, i) => {
    if (isTransit(leg)) return;
    const prev = L[i - 1], next = L[i + 1];
    if (prev && isTransit(prev)) { leg.startTime = prev.endTime; leg.endTime = new Date(ms(prev.endTime) + leg.duration * 1000).toISOString(); }
    else if (next && isTransit(next)) { leg.endTime = next.startTime; leg.startTime = new Date(ms(next.startTime) - leg.duration * 1000).toISOString(); }
  });
  recalc(trip.itin);
  trip.updated = Date.now();
  store.set('omreis.trip', trip);
  evaluate(); render();
  changes.forEach(c => notify(c, 'Perronwijziging', 'omreis-perron'));
  if (trip.started && !state.ride && !document.body.classList.contains('map-focus')) liveCamera();
  if (trip.started && Date.now() - lastBest > 55000) checkBest();
}

/* Bepaalt wat er mis is met de reis. */
function evaluate() {
  const trip = state.trip; state.problems = [];
  if (!trip) return;
  const L = trip.itin.legs, now = Date.now(), P = state.problems;
  if (trip.sim != null && L[trip.sim]) L[trip.sim].cancelled = true;
  L.forEach((leg, i) => {
    if (!isTransit(leg) || ms(leg.endTime) < now) return;
    if (leg.cancelled) P.push({ sev: 'bad', leg: i, key: `c${i}`, text: `${legName(leg)} richting ${leg.headsign || leg.to.name} van ${hhmm(leg.scheduledStartTime || leg.startTime)} rijdt niet.` });
  });
  if (trip.missed != null && L[trip.missed] && ms(L[trip.missed].endTime) > now && !L[trip.missed].cancelled) {
    const m = L[trip.missed];
    P.push({ sev: 'bad', leg: trip.missed, key: `x${trip.missed}`, text: `Het lijkt erop dat je ${theRide(m)} van ${hhmm(m.startTime)} niet hebt gehaald.` });
  } else if (trip.missed != null) trip.missed = null;
  let prev = -1;
  L.forEach((leg, i) => {
    if (!isTransit(leg)) return;
    if (prev >= 0 && ms(leg.startTime) > now && !leg.cancelled && !L[prev].cancelled) {
      const walk = L.slice(prev + 1, i).reduce((s, w) => s + (w.duration || 0), 0) * 1000;
      const margin = ms(leg.startTime) - (ms(L[prev].endTime) + walk);
      if (margin < 0) P.push({ sev: 'bad', leg: i, key: `m${i}`, text: `De overstap op ${legName(leg)} in ${leg.from.name} haal je niet meer (${mins(-margin) || 1} min te laat).` });
      else if (margin < 120000 && walk > 0) P.push({ sev: 'warn', leg: i, key: `k${i}`, text: `Krappe overstap in ${leg.from.name}: loop direct door naar ${legName(leg)}.` });
    }
    prev = i;
  });
  const late = mins(ms(trip.itin.endTime) - ms(trip.origEnd));
  if (late >= 5 && !P.some(p => p.sev === 'bad')) P.push({ sev: 'warn', leg: -1, key: `d${Math.floor(late / 5)}`, text: `Je komt ongeveer ${late} min later aan dan gepland.` });

  const step = P.some(p => p.sev === 'bad') ? (trip.lateStep || 0) : Math.max(0, Math.floor(late / 5));
  if (trip.started && step > (trip.lateStep || 0)) notify(`Je komt nu rond ${hhmm(trip.itin.endTime)} aan, ongeveer ${late} min later dan gepland.`, 'Vertraging', 'omreis-vertraging');
  trip.lateStep = step;
  const key = P.filter(p => p.sev === 'bad').map(p => p.key).join(',');
  if (key && key !== state.problemKey) { if (trip.started) notify(P.find(p => p.sev === 'bad').text); loadAlts(); }
  if (!key && state.altsFor === 'auto') { state.alts = null; state.altsFor = ''; }
  state.problemKey = key;
}

/* Meereizen: aan je gps zien of je echt in je bus of trein zit, of dat je hem gemist hebt. */
function checkProgress() {
  const trip = state.trip;
  if (!trip || !trip.started || !state.gps || Date.now() - state.gps.at > 45000) return;
  const L = trip.itin.legs, now = Date.now(), me = state.gps;
  trip.seen = trip.seen || {};
  const i = L.findIndex((l, k) => isTransit(l) && !l.cancelled && ms(l.endTime) > now && !(trip.seen[k] && trip.seen[k].on));
  if (i < 0) return;
  const leg = L[i], s = trip.seen[i] || (trip.seen[i] = {}), start = ms(leg.startTime);
  if (now < start + 45000 || !leg.legGeometry || !leg.legGeometry.points) return;
  const dStop = distM(me, leg.from), dRoute = distToLine(decodePolyline(leg.legGeometry.points, leg.legGeometry.precision), me);
  if (dStop > 150 && dRoute < 150) {                       // weg van de halte en óp de route: je zit erin
    s.on = true; if (trip.missed === i) trip.missed = null;
    store.set('omreis.trip', trip);
    notify(`Je zit in ${theRide(leg)} richting ${nice(leg.headsign || leg.to.name)}.`, 'Ingestapt', 'omreis-sneller');
    evaluate(); render();
  } else if (!s.missed && now > start + 150000 && (dStop < 200 || dRoute > 400)) {   // ruim na vertrek nog bij de halte, of ergens anders
    s.missed = true; trip.missed = i;
    store.set('omreis.trip', trip);
    evaluate(); render();
  }
}

/* Pop-up in de app, en een systeemmelding als de app op de achtergrond staat. */
let toastTimer;
function notify(text, title = 'Je reis is verstoord', tag = 'omreis-storing') {
  const t = $('#toast');
  t.className = 'toast ' + (tag === 'omreis-storing' ? 'bad' : tag === 'omreis-sneller' ? 'good' : 'warn');
  t.innerHTML = `<strong>${esc(title)}</strong><span>${esc(text)}</span>`;
  t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 9000);
  try { navigator.userActivation?.hasBeenActive && navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch { /* niet ondersteund */ }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opt = { body: text, icon: 'icon-192.png', tag };
  navigator.serviceWorker?.ready.then(r => r.showNotification(title, opt)).catch(() => {
    try { new Notification(title, opt); } catch { /* geen meldingen */ }
  });
}

/* Waar is de reiziger nu (of straks): startpunt voor een alternatief. */
function currentOrigin() {
  const L = state.trip.itin.legs, now = Date.now();
  const bad = state.problems.find(p => p.sev === 'bad');
  if (state.trip.missed != null && state.gps && now - state.gps.at < 120000) return { place: `${state.gps.lat},${state.gps.lon}`, name: 'waar je nu bent', time: now };
  const cur = L.findIndex(l => ms(l.endTime) > now);
  if (cur < 0) return null;
  const leg = L[cur];
  if (isTransit(leg) && ms(leg.startTime) <= now) {   // in een voertuig: uitstappen kan pas bij een halte
    if (bad && bad.leg > cur && !leg.cancelled) {
      const b = L[bad.leg];
      const at = bad.key[0] === 'm' ? L.slice(0, bad.leg).reverse().find(isTransit) : null;
      return at ? { place: placeOf(at.to), name: at.to.name, time: ms(at.endTime) } : { place: placeOf(b.from), name: b.from.name, time: Math.max(now, ms(L[bad.leg - 1]?.endTime || now)) };
    }
    const next = [...(leg.intermediateStops || []), leg.to].find(s => ms(s.arrival || s.departure) > now) || leg.to;
    return { place: placeOf(next), name: next.name, time: ms(next.arrival || next.departure) };
  }
  if (state.trip.started && state.gps && Date.now() - state.gps.at < 120000) return { place: `${state.gps.lat},${state.gps.lon}`, name: 'je huidige locatie', time: now };
  const p = ms(leg.startTime) > now || !isTransit(leg) ? leg.from : leg.to;
  return { place: placeOf(p), name: p.name === 'START' ? 'je vertrekpunt' : p.name, time: now };
}
const destOf = itin => itin.legs[itin.legs.length - 1].to;

async function loadAlts(manual) {
  const trip = state.trip; if (!trip) return;
  const o = currentOrigin(); if (!o) return;
  state.altsLoading = true; state.altsFor = manual ? 'manual' : 'auto'; state.alts = { from: o.name, list: [] };
  render();
  try {
    const data = await api('/v5/plan', { fromPlace: o.place, toPlace: placeOf(destOf(trip.itin)), time: new Date(Math.max(o.time, Date.now())).toISOString(), numItineraries: 5 });
    if (state.trip !== trip) return;
    const usedBad = new Set(trip.itin.legs.filter(l => l.cancelled).map(l => l.tripId));
    state.alts.list = (data.itineraries || [])
      .filter(it => !it.legs.some(l => l.cancelled || usedBad.has(l.tripId)))
      .sort((a, b) => rank(a) - rank(b)).slice(0, 4);
  } catch (err) { state.alts.error = err.message; }
  state.altsLoading = false;
  render();
}

/* Pop-up: een andere (eerdere of latere) rit kiezen vanaf een bepaald punt in de reis. */
async function openLegOptions(i) {
  const trip = state.trip, L = trip.itin.legs, leg = L[i];
  const earliest = Math.max(Date.now(), i > 0 ? ms(L[i - 1].endTime) : 0);
  state.modal = { leg: i, title: 'Kies zelf je reis', sub: `Vanaf ${leg.from.name === 'START' ? 'je vertrekpunt' : leg.from.name}`, loading: true, list: [] };
  renderModal();
  try {
    const data = await api('/v5/plan', { fromPlace: placeOf(leg.from), toPlace: placeOf(destOf(trip.itin)), time: new Date(earliest).toISOString(), numItineraries: 6 });
    if (state.modal?.leg !== i) return;
    state.modal.list = (data.itineraries || []).filter(it => it.legs.some(isTransit)).sort((a, b) => ms(a.startTime) - ms(b.startTime));
  } catch (err) { if (state.modal) state.modal.error = err.message; }
  if (state.modal) { state.modal.loading = false; renderModal(); }
}
function pickLegOption(k) {
  const trip = state.trip, m = state.modal, opt = m.list[k];
  const itin = { ...trip.itin, legs: [...trip.itin.legs.slice(0, m.leg), ...opt.legs] };
  recalc(itin);
  state.modal = null; renderModal();
  openTrip(itin);
}
function renderModal() {
  const m = state.modal, el = $('#modal');
  el.hidden = !m; if (!m) return;
  const cur = state.trip.itin.legs[m.leg].tripId;
  let body;
  if (m.loading) body = '<div class="msg"><span class="spinner"></span>Ritten zoeken…</div>';
  else if (m.error) body = `<div class="msg err">Ophalen lukte niet (${esc(m.error)}).</div>`;
  else if (!m.list.length) body = '<div class="msg">Geen andere ritten gevonden.</div>';
  else body = m.list.map((it, k) => {
    const same = it.legs.find(isTransit).tripId === cur;
    return itinCard(it, k, same ? 'Huidige keuze' : 'Kies', 'pickleg', same, '');
  }).join('');
  $('#modal-body').innerHTML = `<div class="modal-head"><div><h3 id="modal-title">${esc(m.title)}</h3><p class="alts-sub">${esc(m.sub)}</p></div><button class="icon-btn" data-action="closemodal" aria-label="Sluiten">${svg('close')}</button></div>${body}`;
}

/* Zet een reis om in losse, genummerde handelingen: lopen, instappen, uitstappen, overstappen. */
function buildSteps(L, nm) {
  const steps = [];
  let lastEnd = L[0].startTime;
  L.forEach((leg, i) => {
    const prevT = L.slice(0, i).reverse().find(isTransit), nextT = L.slice(i + 1).find(isTransit);
    if (!isTransit(leg)) {
      if (prevT && nextT && leg.duration < 60) return;   // zelfde perron: geen aparte loopstap
      const where = nextT && nextT.from.track ? `perron ${esc(nextT.from.track)}` : nm(leg.to);
      steps.push({
        kind: 'walk', icon: 'walk', start: leg.startTime, end: leg.endTime, time: leg.startTime,
        title: prevT && nextT ? `Loop naar ${where} voor ${esc(theRide(nextT))}` : `Loop naar ${nm(leg.to)}`,
        sub: `${dur(leg.duration)} lopen${leg.distance ? ` · ${Math.round(leg.distance / 10) * 10} m` : ''}`
      });
      lastEnd = leg.endTime;
      return;
    }
    const gap = prevT ? mins(ms(leg.startTime) - ms(prevT.endTime)) : null;
    const gapTxt = gap == null ? '' : gap < 0 ? '<span class="tag bad">overstap niet haalbaar</span>' : `<span class="tag ${gap < 3 ? 'warn' : ''}">${gap} min overstaptijd</span>`;
    steps.push({
      kind: 'in', tripId: leg.tripId, leg, icon: MODE_IC[leg.mode] || (isRail(leg.mode) ? 'train' : 'bus'), start: lastEnd, end: leg.startTime, time: leg.startTime, sched: leg.scheduledStartTime, cancelled: leg.cancelled,
      title: `${prevT ? `Overstappen op ${esc(theRide(leg))}` : esc(rideName(leg, true))} richting ${esc(nice(leg.headsign || leg.to.name))}`,
      sub: `Vanaf ${nm(leg.from)}${leg.from.track ? ` · <strong>perron ${esc(leg.from.track)}</strong>` : ''}${gapTxt}`, chip: chip(leg)
    });
    const mid = leg.intermediateStops || [];
    steps.push({
      kind: 'out', tripId: leg.tripId, leg, icon: 'pin', start: leg.startTime, end: leg.endTime, time: leg.endTime, sched: leg.scheduledEndTime, cancelled: leg.cancelled, mid,
      title: `Uitstappen op ${nm(leg.to)}`,
      sub: `${mid.length ? `na ${mid.length} ${mid.length === 1 ? 'tussenhalte' : 'tussenhaltes'}` : 'dit is de eerstvolgende halte'}${leg.to.track ? ` · perron ${esc(leg.to.track)}` : ''}${nextT ? ` · daarna verder met ${esc(theRide(nextT))}` : ''}`
    });
    lastEnd = leg.endTime;
  });
  return steps;
}
/* In woorden waar een voertuig nu is, op basis van de hele rit. */
function whereIs(leg, now) {
  const st = leg.full; if (!st || !st.length || leg.cancelled) return '';
  const cur = st.findIndex(x => ms(x.departure || x.arrival) > now);
  if (cur < 0) return '';
  if (cur === 0) return `Vertrekt om ${hhmm(st[0].departure || st[0].arrival)} vanaf ${esc(nice(st[0].name))}`;
  if (st[cur].arrival && ms(st[cur].arrival) <= now) return `Staat nu bij ${esc(nice(st[cur].name))}`;
  return `Rijdt nu tussen ${esc(nice(st[cur - 1].name))} en ${esc(nice(st[cur].name))}`;
}
function nowCard(L, now) {
  const i = L.findIndex(l => ms(l.endTime) > now);
  if (i < 0) return { k: 'Aangekomen', v: 'Je bent op je bestemming', s: `Aankomst ${hhmm(L[L.length - 1].endTime)}` };
  const leg = L[i], wait = mins(ms(leg.startTime) - now);
  const toName = esc(leg.to.name === 'END' ? 'je bestemming' : nice(leg.to.name));
  if (ms(leg.startTime) > now) {
    if (!isTransit(leg)) return { k: 'Zo meteen', v: wait > 0 ? `Vertrek over ${wait} min` : 'Vertrek nu', s: `Loop ${dur(leg.duration)} naar ${toName}` };
    let extra = '';
    if (state.gps && leg.from.lat) { const d = distM(state.gps, leg.from); if (d > 80) extra = ` · nog ${d < 1000 ? Math.round(d / 10) * 10 + ' m' : (d / 1000).toFixed(1) + ' km'} naar de halte, ongeveer ${Math.max(1, Math.ceil(d / 75))} min lopen`; }
    return { k: wait <= 0 ? 'Nu instappen' : `Instappen over ${wait} min`, v: `${esc(rideName(leg, true))} richting ${esc(nice(leg.headsign || leg.to.name))}`, s: `${hhmm(leg.startTime)} vanaf ${esc(nice(leg.from.name))}${platform(leg.from)}${extra}` };
  }
  if (!isTransit(leg)) return { k: 'Nu', v: `Loop naar ${toName}`, s: `Nog ongeveer ${Math.max(1, mins(ms(leg.endTime) - now))} min${platform(leg.to)}` };
  const left = (leg.intermediateStops || []).filter(s => ms(s.arrival || s.departure) > now).length;
  return { k: `Onderweg met ${esc(theRide(leg))}`, v: `Uitstappen op ${esc(nice(leg.to.name))}`, s: `${hhmm(leg.endTime)}, over ${Math.max(0, mins(ms(leg.endTime) - now))} min${left ? ` · nog ${left} ${left === 1 ? 'halte' : 'haltes'} ertussen` : ' · dit is de volgende halte'}${platform(leg.to)}` };
}

function renderTrack() {
  const el = $('#view-track'), trip = state.trip;
  if (!trip) { el.innerHTML = ''; return; }
  const L = trip.itin.legs, now = Date.now();
  const P = state.problems, sev = P.some(p => p.sev === 'bad') ? 'bad' : P.length ? 'warn' : 'ok';
  const start = ms(trip.itin.startTime), end = ms(trip.itin.endTime);
  const pct = Math.max(0, Math.min(100, (now - start) / (end - start) * 100));
  const late = mins(end - ms(trip.origEnd));
  const [fromLabel, toLabel] = trip.label.split(' → ');
  const nm = p => esc(p.name === 'START' ? (fromLabel || 'Vertrekpunt') : p.name === 'END' ? (toLabel || 'Bestemming') : nice(p.name));
  const steps = buildSteps(L, nm);
  const curStep = steps.findIndex(s => ms(s.end) > now);
  const stateTxt = { ok: trip.started ? 'Op schema' : 'Rijdt volgens plan', warn: 'Let op', bad: 'Verstoord' }[sev];

  const alert = P.length ? `<div class="alert ${sev}" role="status" aria-live="polite">${svg('alert')}<div><strong>${sev === 'bad' ? 'Je reis is verstoord' : 'Let op'}</strong>${P.map(p => `<p>${esc(p.text)}</p>`).join('')}${P.some(p => p.key[0] === 'x') ? '<button class="btn" data-action="onboard">Ik zit er wel in</button>' : ''}</div></div>` : '';

  let hero = '';
  if (!trip.started) hero = `<button class="btn-primary" data-action="begin">Start reis</button>`;
  else if (sev !== 'bad') { const nc = nowCard(L, now); const nx = curStep >= 0 ? steps[curStep + 1] : null; hero = `<div class="now"><div class="k">${nc.k}</div><div class="v">${nc.v}</div><div class="s">${nc.s}</div>${nx ? `<div class="then"><b>Daarna</b>${nx.title}</div>` : ''}</div>`; }

  let alts = '';
  if (state.alts) {
    alts = `<h2>Alternatieven</h2><p class="alts-sub">Vanaf ${esc(state.alts.from)}</p>`;
    if (state.altsLoading) alts += '<div class="msg"><span class="spinner"></span>Alternatieven zoeken…</div>';
    else if (state.alts.error) alts += `<div class="msg err">Alternatieven ophalen lukte niet (${esc(state.alts.error)}).</div>`;
    else if (!state.alts.list.length) alts += '<div class="msg">Geen rijdend alternatief gevonden. Vraag het personeel of probeer het zo opnieuw.</div>';
    else alts += state.alts.list.map((it, i) => itinCard(it, i, 'Kies deze', 'switch', false, i === 0 ? 'Snelste' : '')).join('');
  }

  let best = '';
  if (trip.started && sev !== 'bad' && state.best) {
    best = state.best.current ? `<div class="bestline">${svg('check')}Dit is nu de snelste reis</div>`
      : `<h2>Betere optie</h2><p class="alts-sub">${state.best.why} · vanaf ${esc(nice(state.best.from))}</p>${itinCard(state.best.itin, 0, 'Wissel', 'usebest', false, '')}`;
  }
  const stepsHtml = steps.map((s, k) => {
    const done = trip.started && ms(s.end) <= now, active = trip.started && k === curStep;
    const stops = '';
    return `<li class="step ${s.kind} ${done ? 'done' : ''} ${active ? 'active' : ''} ${s.cancelled ? 'cancel' : ''}">
      <span class="num">${done ? svg('check') : k + 1}</span>
      <div class="body">
        <div class="ttl">${s.title}${s.cancelled && s.kind === 'in' ? '<span class="pill">rijdt niet</span>' : ''}</div>
        <div class="sub">${s.chip ? `<button class="chipbtn" data-action="ride" data-trip="${esc(s.tripId)}" aria-label="Bekijk waar deze rit nu is">${s.chip}</button>` : ''}${s.sub}</div>${stops}
      </div>
      <span class="when num-t ${s.cancelled ? 'strike' : ''}">${hhmm(s.time)}${s.sched ? delayHtml(s.time, s.sched) : ''}</span>
    </li>`;
  }).join('');

  const live = trip.started && sev !== 'bad';
  let header;
  if (live) {
    const nc = nowCard(L, now), st = steps[curStep], eta = st ? Math.max(0, mins(ms(st.end) - now)) : 0;
    const nt = L.find(l => isTransit(l) && ms(l.startTime) > now);
    let away = '';
    if (st && st.kind === 'in' && nt && nt.full && nt.fullFrom != null) {
      const passed = nt.full.filter(x => ms(x.departure || x.arrival) <= now).length, n = nt.fullFrom - passed + 1;
      if (passed > 0 && n > 0) away = n === 1 ? 'Je halte is de volgende stop' : `Nog ${n} haltes van je vandaan`;
    }
    const wh = nt && st && st.kind === 'in' ? whereIs(nt, now) : '';
    const label = !st ? 'Aangekomen' : st.kind === 'in' ? (eta <= 1 ? 'Nu instappen' : away ? 'Komt eraan' : 'Je volgende rit') : st.kind === 'out' ? 'Onderweg' : 'Lopen';
    const nx = curStep >= 0 ? steps[curStep + 1] : null;
    const rides = L.filter(isTransit);
    const chain = rides.length < 2 ? '' : `<div class="chain">${rides.map((l, i) => `<button class="chipbtn" data-action="ride" data-trip="${esc(l.tripId)}">${chip(l)}</button>` + (i < rides.length - 1 ? `<span class="xfer">${svg('swap')}Overstap ${esc(nice(l.to.name))} · ${Math.max(0, mins(ms(rides[i + 1].startTime) - ms(l.endTime)))} min</span>` : '')).join('')}</div>`;
    const track = L.map(l => `<i class="${isTransit(l) ? '' : 'w'}" style="flex:${Math.max(1, ms(l.endTime) - ms(l.startTime))}${isTransit(l) && hex(l.routeColor) ? `;background:${hex(l.routeColor)}` : ''}"></i>`).join('');
    header = `<div class="livecard">
      <div class="trip-nav"><button class="icon-btn" data-action="stop" aria-label="Reis stoppen">${svg('back')}</button><span class="eyebrow">Naar ${esc(toLabel || destOf(trip.itin).name)}</span><span class="state ${sev}"><i></i>${stateTxt}</span></div>
      <div class="live-main">
        <div class="eta">${st ? `<b class="num">${eta}</b><span>min</span>` : svg('check')}</div>
        <div class="live-txt"><div class="k">${label}</div><div class="v">${nc.v}</div><div class="s">${wh ? `${wh} · ` : ''}${away ? `${away} · ` : ''}${nc.s}</div></div>
      </div>
      <div class="track">${track}<em style="left:${pct.toFixed(1)}%"></em></div>
      ${chain}
      <div class="live-foot"><span>Aankomst <strong class="num">${hhmm(end)}</strong>${late >= 1 ? ` <span class="late">+${late}</span>` : ''}</span>${nx ? `<span class="nx">Daarna: ${nx.title}</span>` : ''}</div>
    </div>`;
  } else {
    header = `    <div class="hero-trip"><div class="trip-nav"><button class="icon-btn" data-action="stop" aria-label="${trip.started ? 'Reis stoppen' : 'Terug naar opties'}">${svg('back')}</button><span class="eyebrow">${trip.started ? 'Onderweg naar' : 'Reis naar'}</span></div>
    <h1>${esc(toLabel || destOf(trip.itin).name)}</h1>
    <div class="arrive"><span>Aankomst <strong class="num">${hhmm(end)}</strong>${late >= 1 ? ` <span class="late">+${late}</span>` : ''} · ${dur(trip.itin.duration)}${walkMin(trip.itin) ? ` · ${walkMin(trip.itin)} min lopen` : ''}</span><span class="state ${sev}"><i></i>${stateTxt}</span></div>
    ${trip.started ? `<div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>` : ''}</div>`;
  }
  el.innerHTML = `
    ${header}
    ${alert}${live ? '' : hero}${best}${alts}${L.map(l => alertsHtml(l.alerts)).join('')}
    ${trip.started ? `<details class="whole"><summary>Hele reis bekijken</summary><ol class="steps">${stepsHtml}</ol></details>` : `<h2>Je reis</h2><ol class="steps">${stepsHtml}</ol>`}
    <div class="updated">Bijgewerkt om ${hhmm(trip.updated)}${navigator.onLine ? '' : ' · offline'}</div>
    <details class="more"><summary>Meer</summary><div>
      <button class="btn-text" data-action="sim">${trip.sim != null ? 'Teststoring uitzetten' : 'Teststoring simuleren'}</button>
    </div></details>`;
}

/* ---------- opgeslagen lijnen ---------- */
const lineOf = leg => ({ short: leg.displayName || leg.routeShortName || '', label: legName(leg), mode: leg.mode, color: leg.routeColor || '', agency: leg.agencyName || '' });
const lineKey = l => `${l.agency}|${l.mode}|${l.short}`;
function linesHtml(edit) {
  if (!state.lines.length) return '';
  return `<h2>Opgeslagen lijnen</h2><div class="favs">${state.lines.map((l, i) => `<span class="quick-item"><button class="btn${state.lineFilter && lineKey(state.lineFilter) === lineKey(l) ? ' sel' : ''}" data-action="line" data-i="${i}">${chip({ mode: l.mode, displayName: l.short, routeColor: l.color })}${esc(l.agency)}</button>${edit ? `<button class="icon-btn" data-action="delline" data-i="${i}" aria-label="Verwijder lijn">${svg('close')}</button>` : ''}</span>`).join('')}</div>`;
}

/* ---------- meldingen van vervoerders ---------- */
function alertsHtml(alerts) {
  return (alerts || []).map(a => {
    const h = a.headerText || '', d = a.descriptionText || '';
    return h || d ? `<div class="alert warn">${svg('alert')}<div><strong>${esc(h || 'Melding')}</strong>${d && d !== h ? `<p>${esc(d)}</p>` : ''}</div></div>` : '';
  }).join('');
}

/* ---------- één rit bekijken (vanuit vertrektijden of een voertuig op de kaart) ---------- */
async function openRide(tripId) {
  state.ride = { tripId, loading: true };
  setSheet('half'); render();
  try {
    const t = await api('/v5/trip', { tripId });
    if (state.ride?.tripId !== tripId) return;
    state.ride.leg = t.legs[0]; state.ride.updated = Date.now();
  } catch (err) { if (state.ride?.tripId === tripId) state.ride.error = err.message; }
  if (state.ride?.tripId === tripId) { state.ride.loading = false; render(); paintVehicles(); }
}
function renderRide() {
  const r = state.ride, el = $('#view-ride');
  const nav = t => `<div class="trip-nav"><button class="icon-btn" data-action="closeride" aria-label="Terug">${svg('back')}</button><span class="eyebrow">${esc(t)}</span></div>`;
  if (r.loading) { el.innerHTML = nav('Rit') + '<div class="msg"><span class="spinner"></span>Rit laden…</div>'; return; }
  if (r.error || !r.leg) { el.innerHTML = nav('Rit') + `<div class="msg err">Rit ophalen lukte niet (${esc(r.error || 'onbekend')}).</div>`; return; }
  const leg = r.leg, st = [leg.from, ...(leg.intermediateStops || []), leg.to], now = Date.now();
  const nx = st.findIndex(x => ms(x.arrival || x.departure) > now);
  const cur = st.findIndex(x => ms(x.departure || x.arrival) > now);   // eerste halte die nog niet verlaten is
  const atStop = cur > 0 && st[cur].arrival && ms(st[cur].arrival) <= now;
  const late = nx >= 0 ? mins(ms(st[nx].arrival || st[nx].departure) - ms(st[nx].scheduledArrival || st[nx].scheduledDeparture || st[nx].arrival || st[nx].departure)) : 0;
  const status = leg.cancelled ? 'Deze rit rijdt niet' : cur < 0 ? 'Rit is afgelopen'
    : cur === 0 ? `Vertrekt om ${hhmm(st[0].departure)} vanaf ${esc(nice(st[0].name))}`
    : atStop ? `Staat nu bij <strong>${esc(nice(st[cur].name))}</strong>`
    : `Rijdt nu tussen <strong>${esc(nice(st[cur - 1].name))}</strong> en <strong>${esc(nice(st[cur].name))}</strong>`;
  const vcolor = hex(leg.routeColor) || (isRail(leg.mode) ? '#2B1A66' : '#5B2EFF');
  const vdot = `<span class="veh-dot" style="background:${vcolor}">${svg(MODE_IC[leg.mode] || (isRail(leg.mode) ? 'train' : 'bus'))}</span>`;
  const rowList = st.map((x, i) => {
    const t = (i === 0 ? x.departure : x.arrival) || x.departure || x.arrival, sch = (i === 0 ? x.scheduledDeparture : x.scheduledArrival) || x.scheduledDeparture;
    const here = i === cur && !leg.cancelled;
    let pre = '';
    if (here && cur > 0 && !atStop) {
      const d = ms(st[i - 1].departure || st[i - 1].arrival), arr = ms(x.arrival || x.departure), left = Math.max(0, mins(arr - now));
      pre = `<div class="here">${vdot}<span>Rijdt nu hier · ${left < 1 ? 'komt zo aan' : `nog ${left} min`} tot ${esc(nice(x.name))}</span><i style="width:${Math.round(100 * Math.max(0, Math.min(1, (now - d) / (arr - d || 1))))}%"></i></div>`;
    }
    const tag = here && atStop ? `${vdot}<span class="tag">staat nu hier</span>` : here && cur === 0 ? '<span class="tag">vertrekt hier</span>' : '';
    return `${pre}<div class="pt ${ms(x.departure || x.arrival) <= now ? 'passed' : ''} ${here && atStop ? 'at' : ''}"><span class="t ${x.cancelled ? 'strike' : ''}">${hhmm(t)}${sch ? delayHtml(t, sch) : ''}</span><span class="n">${esc(nice(x.name))}${tag}</span>${x.track ? `<span class="trk">perron ${esc(x.track)}</span>` : ''}</div>`;
  });
  const hideN = cur < 0 ? 0 : Math.max(0, cur - 1);   // alles vóór de laatst gepasseerde halte
  const rows = (hideN > 1 ? `<details class="earlier"${r.earlierOpen ? ' open' : ''}><summary>${hideN} eerdere haltes</summary>${rowList.slice(0, hideN).join('')}</details>` : rowList.slice(0, hideN).join('')) + rowList.slice(hideN).join('');
  const savedLine = state.lines.some(l => lineKey(l) === lineKey(lineOf(leg)));
  el.innerHTML = `<div class="hero-trip">${nav(leg.agencyName || 'Rit')}<button class="icon-btn star save-line ${savedLine ? 'on' : ''}" data-action="saveline" aria-label="${savedLine ? 'Lijn verwijderen uit opgeslagen' : 'Lijn opslaan'}" title="Lijn opslaan">${svg('star')}</button>
      <h1>${esc(rideName(leg, true))} naar ${esc(nice(leg.headsign || leg.to.name))}</h1>
      <div class="arrive"><span>${status}</span><span class="state ${leg.cancelled ? 'bad' : late >= 2 ? 'warn' : 'ok'}"><i></i>${leg.cancelled ? 'Vervalt' : late >= 1 ? `+${late} min` : 'Op tijd'}</span></div>
    </div>
    ${alertsHtml(leg.alerts)}
    <div class="timeline"><div class="leg" style="--c:${hex(leg.routeColor) || 'var(--accent)'}">${rows}</div></div>
    <div class="updated">Bijgewerkt om ${hhmm(r.updated)}</div>`;
}

/* ---------- haltes in de buurt ---------- */
function nearby() {
  if (!navigator.geolocation) return;
  state.near = { loading: true }; renderBoard();
  getPos(async p => {
    const me = { lat: p.coords.latitude, lon: p.coords.longitude };
    state.gps = { ...me, at: Date.now() }; drawMe();
    try {
      const d = await api('/v1/map/stops', { min: `${me.lat + 0.006},${me.lon - 0.01}`, max: `${me.lat - 0.006},${me.lon + 0.01}` });
      state.near = { list: groupStops(d).map(g => ({ id: g.ids.join('|'), ids: g.ids, label: g.name, dist: distM(me, g) })).sort((x, y) => x.dist - y.dist).slice(0, 8) };
    } catch { state.near = { error: 'Haltes ophalen lukte niet.' }; }
    renderBoard();
  }, e => { state.near = { error: e && e.code === 1 ? 'Locatie staat uit voor Omreis; zet hem aan in je browserinstellingen.' : 'Je locatie is nu niet te bepalen.' }; renderBoard(); });
}

/* ---------- vertrektijden ---------- */
async function loadBoard(stop) {
  const same = state.board && state.board.stop.id === stop.id;
  state.board = { stop, items: same ? state.board.items : null, mode: same ? state.board.mode : null, updated: null };
  renderBoard();
  try {
    const ids = stop.ids || [stop.id];
    const parts = await Promise.all(ids.map(id => api('/v5/stoptimes', { stopId: id, n: ids.length > 1 ? 16 : 30 }).catch(() => ({ stopTimes: [] }))));
    if (state.board?.stop.id !== stop.id) return;
    const seen = new Set();
    state.board.items = parts.flatMap(p => p.stopTimes || []).filter(s => s.place.departure && !seen.has(s.tripId) && seen.add(s.tripId))
      .sort((x, y) => ms(x.place.departure) - ms(y.place.departure)).slice(0, 80);
    state.board.updated = Date.now(); state.board.error = null;
  } catch (err) { if (state.board) state.board.error = err.message; }
  renderBoard();
}
function renderBoard() {
  $('#lines').innerHTML = linesHtml(false);
  $('#favs').innerHTML = state.favs.map((f, i) => `<button class="btn" data-fav="${i}">${svg('star')}${esc(f.label)}</button>`).join('');
  const n = state.near;
  $('#nearby').innerHTML = !n ? '' : n.loading ? '<span class="spinner"></span>' : n.error ? `<small>${esc(n.error)}</small>`
    : n.list.length ? n.list.map((x, i) => `<button class="btn" data-near="${i}">${svg('stop')}${esc(x.label)}<small>${Math.round(x.dist / 10) * 10} m</small></button>`).join('') : '<small>Geen haltes binnen loopafstand gevonden.</small>';
  const b = state.board, el = $('#board');
  if (!b) { el.innerHTML = '<div class="msg">Zoek een halte of station om de actuele vertrektijden te zien.</div>'; return; }
  const fav = state.favs.some(f => f.id === b.stop.id);
  let body;
  if (b.error && !b.items) body = `<div class="msg err">Ophalen lukte niet (${esc(b.error)}).</div>`;
  else if (!b.items) body = '<div class="msg"><span class="spinner"></span>Vertrektijden laden…</div>';
  else if (!b.items.length) body = '<div class="msg">Geen vertrekken gevonden voor deze halte.</div>';
  else {
    const CATS = ['Trein', 'Metro', 'Tram', 'Bus', 'Veer'];
    const cat = m => isRail(m) ? 'Trein' : KIND[m] || 'Bus';
    const all = b.items.filter(s => s.place.departure), cats = CATS.filter(c => all.some(s => cat(s.mode) === c));
    const sel = cats.includes(b.mode) ? b.mode : cats[0];
    const tabs = cats.length > 1 ? `<div class="modes">${cats.map(c => `<button class="btn${c === sel ? ' sel' : ''}" data-action="boardmode" data-m="${c}">${svg({ Trein: 'train', Metro: 'metro', Tram: 'tram', Bus: 'bus', Veer: 'ferry' }[c])}${c}</button>`).join('')}</div>` : '';
    body = tabs + '<div class="board">' + all.filter(s => cat(s.mode) === sel).map(s => {
    const p = s.place, c = s.cancelled || p.cancelled, d = mins(ms(p.departure) - ms(p.scheduledDeparture));
    return `<button type="button" class="dep ${c ? 'cancelled' : ''}" data-action="ride" data-trip="${esc(s.tripId)}">
      <span class="t"><span class="${c ? 'strike' : ''}">${hhmm(p.scheduledDeparture)}</span>${c ? '<small class="gone">vervalt</small>' : d >= 1 ? `<small class="late">+${d} min</small>` : ''}</span>
      <span class="d">${chip(s)}<span>${esc(s.headsign || '')}</span><small>${esc(s.agencyName || '')}</small></span>
      ${p.track ? `<span class="trk">perron ${esc(p.track)}</span>` : ''}
    </button>`;
    }).join('') + '</div>';
  }
  el.innerHTML = `<div class="board-head"><h3>${esc(b.stop.label)}</h3><span class="head-btns"><button class="icon-btn star ${fav ? 'on' : ''}" data-action="fav" aria-label="${fav ? 'Verwijder favoriet' : 'Bewaar als favoriet'}">${svg('star')}</button></span></div>
    ${body}${b.updated ? `<div class="updated">Bijgewerkt om ${hhmm(b.updated)}</div>` : ''}`;
}

/* ---------- gps ---------- */
let gpsWatch = null;
function watchGps() {
  if (gpsWatch != null || !navigator.geolocation) return;
  gpsWatch = navigator.geolocation.watchPosition(
    p => { state.gps = { lat: p.coords.latitude, lon: p.coords.longitude, at: Date.now() }; drawMe(); },
    () => {}, { enableHighAccuracy: true, maximumAge: 20000, timeout: 20000 });
}
/* Eerst snel en grof (werkt ook binnen), daarna pas nauwkeurig; geweigerde toestemming meteen doorgeven. */
function getPos(ok, fail) {
  if (!navigator.geolocation) return fail({ code: 0 });
  // Blijven luisteren tot er een positie is: op iPhone komt de eerste meting vaak pas na een paar seconden,
  // en een losse eenmalige vraag geeft het dan te vroeg op.
  let done = false, last = { code: 3 };
  const finish = (fn, arg) => { if (done) return; done = true; clearTimeout(timer); navigator.geolocation.clearWatch(id); fn(arg); };
  const id = navigator.geolocation.watchPosition(p => finish(ok, p), e => { last = e; if (e.code === 1) finish(fail, e); },
    { enableHighAccuracy: true, maximumAge: 60000, timeout: 25000 });
  const timer = setTimeout(() => finish(fail, last), 26000);
}
function useMyLocation(quiet) {
  if (!navigator.geolocation) { if (!quiet) setMsg('Je browser geeft geen locatie door.', true); return; }
  if (!quiet) { $('#from').value = 'Locatie bepalen…'; state.locating = true; }
  if (!quiet) renderPlan();
  getPos(p => {
    state.gps = { lat: p.coords.latitude, lon: p.coords.longitude, at: Date.now() }; state.locating = false; state.gpsDenied = false;
    if (quiet && (state.from || $('#from').value || state.trip)) { drawMe(); if (mapReady && !state.trip) map.easeTo({ center: [state.gps.lon, state.gps.lat], zoom: 14 }); return; }
    state.from = { label: 'Mijn locatie', place: `${state.gps.lat},${state.gps.lon}`, lat: state.gps.lat, lon: state.gps.lon };
    $('#from').value = 'Mijn locatie';
    drawMe(); watchGps(); endpointsChanged();
  }, e => { state.locating = false; if (!quiet) { $('#from').value = ''; state.gpsDenied = true; state.gpsError = e ? e.code : 0; state.showFrom = true; renderPlan(); } });
}

/* ---------- paneel ---------- */
const SIZES = ['peek', 'half', 'full'];
function focusMap(on) { document.body.classList.toggle('map-focus', on); }
function setSheet() { $('#sheet').dataset.size = 'full'; focusMap(false); }   // er is maar één open stand
(function sheetDrag() {
  const h = $('#handle'); let y0 = null;
  h.addEventListener('pointerdown', e => { y0 = e.clientY; h.setPointerCapture(e.pointerId); });
  h.addEventListener('pointerup', e => {
    if (y0 == null) return;
    const dy = e.clientY - y0, down = document.body.classList.contains('map-focus'); y0 = null;
    if (dy > 15) return focusMap(true);      // omlaag vegen: weg
    if (dy < -15) return focusMap(false);    // omhoog vegen: open
    focusMap(!down);                         // tik: wissel
  });
})();

/* ---------- weergave & events ---------- */
function render() {
  const view = state.ride ? 'ride' : state.stopsOpen ? 'stops' : state.trip ? 'trip' : 'plan';
  $('#view-ride').hidden = view !== 'ride';
  if (view === 'ride') renderRide();
  $('#veh-btn').classList.toggle('on', !state.ride && (state.trip || state.results.length) ? state.showAll : state.vehOn);
  $('#view-plan').hidden = view !== 'plan';
  $('#view-track').hidden = view !== 'trip';
  $('#view-stops').hidden = view !== 'stops';
  $('#plan-form').hidden = view !== 'plan';
  $('#quick').hidden = view !== 'plan';
  const started = view === 'trip' && state.trip.started;
  document.body.dataset.view = view;
  $('#nav-back').hidden = view === 'plan' || started;
  $('.brand').hidden = !$('#nav-back').hidden;
  $('#trip-actions').hidden = !started;
  $('#stops-btn').hidden = view !== 'plan';
  $('#net').hidden = navigator.onLine;
  const lp = $('#line-pill'); lp.hidden = !state.lineFilter || view === 'ride' || !!state.trip;
  if (state.lineFilter) lp.innerHTML = `${esc(state.lineFilter.label)} ${svg('close')}`;
  if (view === 'trip') {
    const open = [...document.querySelectorAll('#view-track details')].map(d => d.open);   // stand van uitklappers behouden
    renderTrack();
    document.querySelectorAll('#view-track details').forEach((d, i) => { if (open[i] != null) d.open = open[i]; });
  }
  if (view === 'plan') renderPlan();
  if (view === 'stops') renderBoard();
  drawMap();
}

document.addEventListener('click', e => {
  if (e.target.id === 'modal') { state.modal = null; return renderModal(); }
  const nearBtn = e.target.closest('[data-near]');
  if (nearBtn) return loadBoard(state.near.list[+nearBtn.dataset.near]);
  const favBtn = e.target.closest('[data-fav]');
  if (favBtn) return loadBoard(state.favs[+favBtn.dataset.fav]);
  const a = e.target.closest('[data-action]'); if (!a) return;
  const i = +a.dataset.i;
  switch (a.dataset.action) {
    case 'select':
      if (i === state.sel) openTrip(state.results[i], `${state.from.label} → ${state.to.label}`);
      else { state.sel = i; state.othersOpen = false; renderPlan(); drawMap(); $('#sheet-body').scrollTop = 0; }
      break;
    case 'page': searchPlan({ cursor: state.cursors[a.dataset.dir] }); break;
    case 'begin': beginTrip(); break;
    case 'onboard': { const t = state.trip; if (t.missed != null) { t.seen[t.missed].on = true; t.missed = null; store.set('omreis.trip', t); evaluate(); render(); } break; }
    case 'navback':
      if (state.ride) { state.ride = null; render(); paintVehicles(); }
      else if (state.stopsOpen) { state.stopsOpen = false; render(); }
      else if (state.trip) closeTrip();
      break;
    case 'boardmode': state.board.mode = a.dataset.m; renderBoard(); break;
    case 'refreshall':
      a.classList.add('spin'); setTimeout(() => a.classList.remove('spin'), 900);
      if (state.ride) openRide(state.ride.tripId);
      else if (state.stopsOpen) { if (state.board) loadBoard(state.board.stop); }
      else if (state.trip) refreshTrip();
      else searchPlan();
      fetchVehicles(); break;
    case 'retryloc': state.gpsDenied = false; state.showFrom = false; useMyLocation(false); break;
    case 'showfrom': state.showFrom = true; renderPlan(); $('#from').focus(); break;
    case 'saveline': {
      const l = lineOf(state.ride.leg), k = state.lines.findIndex(x => lineKey(x) === lineKey(l));
      k >= 0 ? state.lines.splice(k, 1) : state.lines.unshift(l);
      store.set('omreis.lines', state.lines); render(); break;
    }
    case 'line': {
      const l = state.lines[i];
      state.lineFilter = state.lineFilter && lineKey(state.lineFilter) === lineKey(l) ? null : l;
      if (state.lineFilter) { state.stopsOpen = false; if (!state.vehOn) { state.vehOn = true; store.set('omreis.veh', true); fetchVehicles(); } }
      render(); break;
    }
    case 'clearline': state.lineFilter = null; render(); break;
    case 'delline': state.lines.splice(i, 1); store.set('omreis.lines', state.lines); state.lineFilter = null; render(); break;
    case 'place': {
      const k = a.dataset.k, p = state.places[k];
      if (p) { state.pickFor = null; setEndpoints(state.from && state.from.place !== p.place ? state.from : null, p); if (state.from?.place === p.place) { state.from = null; $('#from').value = ''; useMyLocation(false); } }
      else { state.pickFor = k; state.to = null; $('#to').value = ''; renderPlan(); $('#to').focus(); }
      break;
    }
    case 'delplace': delete state.places[a.dataset.k]; store.set('omreis.places', state.places); renderPlan(); break;
    case 'edit': state.editing = !state.editing; renderPlan(); break;
    case 'savetrip': {
      const k = savedIndex();
      if (k >= 0) state.saved.splice(k, 1);
      else state.saved.unshift({ from: state.from.label === 'Mijn locatie' ? { gps: true, label: 'Mijn locatie' } : state.from, to: state.to });
      store.set('omreis.saved', state.saved); renderPlan(); break;
    }
    case 'usesaved': {
      const t = state.saved[i], rev = !!a.dataset.rev;
      if (t.from.gps) { state.from = null; $('#from').value = ''; setEndpoints(null, t.to); }
      else setEndpoints(rev ? t.to : t.from, rev ? t.from : t.to);
      break;
    }
    case 'delsaved': state.saved.splice(i, 1); store.set('omreis.saved', state.saved); renderPlan(); break;
    case 'startbest': openTrip(state.results[state.sel], `${state.from.label} → ${state.to.label}`); beginTrip(); break;
    case 'usebest': openTrip(state.best.itin); checkBest(); break;
    case 'ride': openRide(a.dataset.trip); break;
    case 'closeride': state.ride = null; render(); paintVehicles(); break;
    case 'refreshride': openRide(state.ride.tripId); break;
    case 'nearby': nearby(); break;
    case 'veh':
      if (!state.ride && (state.trip || state.results.length)) { state.showAll = !state.showAll; if (state.showAll && !state.vehOn) { state.vehOn = true; store.set('omreis.veh', true); } }
      else { state.vehOn = !state.vehOn; store.set('omreis.veh', state.vehOn); }
      render(); fetchVehicles(); break;
    case 'center': if (state.gps && mapReady) map.easeTo({ center: [state.gps.lon, state.gps.lat], zoom: Math.max(map.getZoom(), 14) }); else useMyLocation(true); break;
    case 'switch': openTrip(state.alts.list[i]); break;
    case 'legopt': openLegOptions(i); break;
    case 'manual': {
      const L = state.trip.itin.legs, now = Date.now();
      const k = L.findIndex(l => isTransit(l) && ms(l.startTime) > now);
      if (k < 0) alert('Je zit al in je laatste rit; er valt niets meer te kiezen.'); else openLegOptions(k);
      break;
    }
    case 'pickleg': pickLegOption(i); break;
    case 'closemodal': state.modal = null; renderModal(); break;
    case 'alts': loadAlts(true); break;
    case 'refresh': refreshTrip(); break;
    case 'refreshplan': searchPlan(); break;
    case 'refreshboard': loadBoard(state.board.stop); break;
    case 'stop': if (!state.trip.started || confirm('Stoppen met het volgen van deze reis?')) closeTrip(); break;
    case 'stops': state.stopsOpen = true; setSheet('full'); render(); break;
    case 'closestops': state.stopsOpen = false; setSheet('half'); render(); break;
    case 'sim': {
      const t = state.trip, now = Date.now();
      if (t.sim != null) { t.itin.legs[t.sim].cancelled = false; t.sim = null; }
      else {
        const k = t.itin.legs.findIndex(l => isTransit(l) && ms(l.startTime) > now);
        const k2 = k >= 0 ? k : t.itin.legs.findIndex(l => isTransit(l) && ms(l.endTime) > now);
        if (k2 < 0) { alert('Er is geen rit meer om te verstoren.'); break; }
        t.sim = k2;
      }
      store.set('omreis.trip', t); evaluate(); render(); $('#sheet-body').scrollTop = 0; break;
    }
    case 'fav': {
      const s = state.board.stop, k = state.favs.findIndex(f => f.id === s.id);
      k >= 0 ? state.favs.splice(k, 1) : state.favs.push(s);
      store.set('omreis.favs', state.favs); renderBoard(); break;
    }
  }
});

autocomplete($('#from'), $('#from-list'), { gps: true, onPick: v => { state.from = v; endpointsChanged(); } });
autocomplete($('#to'), $('#to-list'), { onPick: v => {
  if (v && state.pickFor) {   // adres voor thuis of werk vastleggen
    state.places[state.pickFor] = { ...v, label: PLACE_NAME[state.pickFor], sub: v.label };
    store.set('omreis.places', state.places);
    state.pickFor = null; state.to = null; $('#to').value = '';
    return renderPlan();
  }
  state.to = v; endpointsChanged();
} });
autocomplete($('#stop-q'), $('#stop-list'), { stopsOnly: true, onPick: v => { if (v) loadBoard({ id: v.id, label: v.sub ? `${v.label} (${v.sub})` : v.label }); } });
$('#plan-form').addEventListener('submit', e => { e.preventDefault(); searchPlan(); });
$('#gps-btn').addEventListener('click', () => useMyLocation(false));
$('#swap').addEventListener('click', () => {
  [state.from, state.to] = [state.to, state.from];
  $('#from').value = state.from?.label || ''; $('#to').value = state.to?.label || '';
  endpointsChanged();
});
$('#when').addEventListener('change', () => searchPlan());
$('#when-mode').addEventListener('change', () => searchPlan());
$('#when-now').addEventListener('click', () => { $('#when').value = ''; searchPlan(); });
addEventListener('online', () => { render(); refreshTrip(); });
addEventListener('offline', render);
document.addEventListener('toggle', e => {
  if (!e.target.classList) return;
  if (e.target.classList.contains('others')) state.othersOpen = e.target.open;
  if (e.target.classList.contains('earlier') && state.ride) state.ride.earlierOpen = e.target.open;
}, true);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(true); });

let lastRefresh = 0;
function tick(force) {
  if (!document.hidden && state.ride && state.ride.leg) { const sc = $('#sheet-body').scrollTop; renderRide(); $('#sheet-body').scrollTop = sc; }
  if (document.hidden || state.stopsOpen || state.ride || !state.trip) return;
  checkProgress(); evaluate(); if (!state.modal) render();
  // alleen een gestarte reis wordt bewaakt; al het andere ververs je zelf
  if (state.trip.started && (force || Date.now() - lastRefresh >= REFRESH_MS)) { lastRefresh = Date.now(); refreshTrip(); }
}
setInterval(tick, 10000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
initMap();
if (state.trip) { if (state.trip.started) watchGps(); evaluate(); }
render();
tick(true);
// Vertrekpunt alvast invullen als locatietoegang al eerder is gegeven (geen ongevraagde pop-up).
navigator.permissions?.query({ name: 'geolocation' }).then(p => { if (p.state === 'granted' && !state.trip) useMyLocation(true); }).catch(() => {});
