/* Kaartstijlen voor Omreis. Gedeeld door de app en de keuzepagina (kaarten.html). */
(function () {
  const OFM = 'https://tiles.openfreemap.org/styles/';
  // Kleurt een neutrale basiskaart om naar een eigen palet.
  function recolor(map, p) {
    map.getStyle().layers.forEach(l => {
      const sl = l['source-layer'] || '', id = l.id;
      try {
        if (l.type === 'background') map.setPaintProperty(id, 'background-color', p.land);
        else if (l.type === 'fill' && sl === 'water') map.setPaintProperty(id, 'fill-color', p.water);
        else if (l.type === 'line' && sl === 'waterway') map.setPaintProperty(id, 'line-color', p.water);
        else if (l.type === 'fill' && (sl === 'park' || /wood|grass|park/.test(id))) { map.setPaintProperty(id, 'fill-color', p.green); map.setPaintProperty(id, 'fill-opacity', 1); }
        else if (l.type === 'fill' && sl === 'landcover') map.setPaintProperty(id, 'fill-color', p.green);
        else if (l.type === 'fill' && sl === 'landuse') map.setPaintProperty(id, 'fill-color', p.built);
        else if (l.type === 'fill' && sl === 'building') { map.setPaintProperty(id, 'fill-color', p.building); if (map.getPaintProperty(id, 'fill-outline-color') !== undefined) map.setPaintProperty(id, 'fill-outline-color', p.building); }
        else if (l.type === 'line' && sl === 'transportation' && /rail/.test(id)) map.setPaintProperty(id, 'line-color', p.rail);
        else if (l.type === 'line' && sl === 'transportation' && !/casing|outline/.test(id) && p.road) map.setPaintProperty(id, 'line-color', p.road);
        else if (l.type === 'line' && sl === 'transportation' && /casing|outline/.test(id) && p.roadEdge) map.setPaintProperty(id, 'line-color', p.roadEdge);
        else if (l.type === 'symbol' && p.text && l.paint && l.paint['text-color'] !== undefined) { map.setPaintProperty(id, 'text-color', p.text); map.setPaintProperty(id, 'text-halo-color', p.land); }
      } catch (e) { /* laag kent deze eigenschap niet */ }
    });
  }
  // Maakt de kaart rustiger: minder lagen, minder namen, gebouwen en zijstraten pas als je inzoomt.
  function declutter(map, motorway) {
    const hide = ['highway_path', 'railway_transit', 'railway_transit_dashline', 'railway_service', 'railway_service_dashline', 'railway_dashline',
      'aeroway-taxiway', 'road_pier', 'road_area_pier', 'boundary_3', 'waterway_line_label', 'highway-name-path', 'highway_major_casing',
      'highway_major_subtle', 'highway_motorway_subtle', 'tunnel_motorway_casing', 'highway_motorway_bridge_casing', 'landcover_wood', 'airport'];
    const zoom = { building: 15.5, highway_minor: 12.5, 'highway-name-minor': 16, 'highway-name-major': 13.5, label_other: 13.5, label_village: 10.5, railway: 11 };
    map.getStyle().layers.forEach(l => {
      try {
        if (hide.includes(l.id)) map.setLayoutProperty(l.id, 'visibility', 'none');
        if (zoom[l.id]) map.setLayerZoomRange(l.id, zoom[l.id], 24);
        if (/motorway/.test(l.id) && /inner/.test(l.id)) map.setPaintProperty(l.id, 'line-color', motorway);
        if (l.id === 'highway_motorway_casing') map.setPaintProperty(l.id, 'line-color', motorway);
        if (l.id === 'railway') map.setPaintProperty(l.id, 'line-width', 1.2);
      } catch (e) { /* laag bestaat niet in deze stijl */ }
    });
  }
  const firstSymbol = map => (map.getStyle().layers.find(l => l.type === 'symbol') || {}).id;
  // Gebouwen in 3D, zodat de kaart diepte krijgt als je inzoomt.
  function buildings3d(map, color, opacity, from) {
    const z = from || 13;
    try {
      map.setLayoutProperty('building', 'visibility', 'none');
      map.addLayer({
        id: 'omreis-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: z,
        paint: {
          'fill-extrusion-color': color, 'fill-extrusion-opacity': opacity,
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], z, 0, z + 1.2, ['coalesce', ['get', 'render_height'], 8]],
          'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], z, 0, z + 1.2, ['coalesce', ['get', 'render_min_height'], 0]]
        }
      }, firstSymbol(map));
    } catch (e) { /* stijl zonder gebouwenlaag */ }
  }
  // Luchtfoto van Nederland (PDOK, open data) met plaats- en straatnamen eroverheen.
  function aerial(map) {
    const sym = firstSymbol(map);
    map.getStyle().layers.forEach(l => { if (l.type !== 'symbol') { try { map.setLayoutProperty(l.id, 'visibility', 'none'); } catch (e) {} } });
    map.addSource('luchtfoto', { type: 'raster', tileSize: 256, maxzoom: 19, attribution: 'Luchtfoto: PDOK', tiles: ['https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg'] });
    map.addLayer({ id: 'luchtfoto', type: 'raster', source: 'luchtfoto' }, sym);
    map.getStyle().layers.forEach(l => {
      if (l.type !== 'symbol') return;
      try { map.setPaintProperty(l.id, 'text-color', '#fff'); map.setPaintProperty(l.id, 'text-halo-color', 'rgba(20,14,50,.85)'); map.setPaintProperty(l.id, 'text-halo-width', 1.6); } catch (e) {}
    });
  }
  // Moderne ondergrond: brede zachte wegen zonder randen, rustige vlakken, weinig namen, gebouwen met diepte.
  function modern(map) {
    ['landuse_residential', 'aeroway-area', 'aeroway-runway', 'aeroway-runway-casing', 'highway-shield-non-us', 'label_other', 'water_name_point_label', 'water_name_line_label', 'highway_motorway_casing'].forEach(id => { try { map.setLayoutProperty(id, 'visibility', 'none'); } catch (e) {} });
    const exp = (...s) => ['interpolate', ['exponential', 1.6], ['zoom'], ...s];
    const set = (id, k, v) => { try { map.setPaintProperty(id, k, v); } catch (e) {} };
    try { map.setLayerZoomRange('highway_minor', 12.5, 24); map.setLayerZoomRange('railway', 7, 24); map.setLayerZoomRange('highway-name-major', 14, 24); map.setLayerZoomRange('highway-name-minor', 15.5, 24); } catch (e) {}
    set('highway_minor', 'line-width', exp(12.5, 0.6, 14, 2.5, 16, 9, 18, 26));
    set('highway_major_inner', 'line-width', exp(10, 1.2, 13, 4, 16, 13, 18, 32));
    ['highway_motorway_inner', 'highway_motorway_bridge_inner', 'tunnel_motorway_inner'].forEach(id => set(id, 'line-width', exp(6, 1, 10, 2.5, 13, 6, 16, 16, 18, 36)));
    set('railway', 'line-width', ['interpolate', ['linear'], ['zoom'], 7, 1.4, 12, 3, 16, 5]);
    ['label_city', 'label_city_capital', 'label_town', 'label_village'].forEach(id => { set(id, 'text-color', '#2B1A66'); set(id, 'text-halo-color', '#FFFFFF'); set(id, 'text-halo-width', 1.6); });
    ['highway-name-major', 'highway-name-minor'].forEach(id => { set(id, 'text-color', '#7A739B'); set(id, 'text-halo-color', '#FFFFFF'); set(id, 'text-halo-width', 1.2); });
  }
  window.OMREIS_MAPS = {
    circuit: {
      label: 'Lijnennet', note: 'Moderne lichte kaart met het spoor en de buslijnen voorop', style: OFM + 'positron', pitch: 0,
      tweak: m => { recolor(m, { land: '#EEEBF5', water: '#C7DAFF', green: '#D9EDCF', built: '#EEEBF5', building: '#E3DEEE', rail: '#2B1A66', road: '#FFFFFF', text: '#5F5884' }); declutter(m, '#DCD3F3'); modern(m); }
    },
    liberty: { label: 'Kleur', note: 'Zoals een gewone wegenkaart, alle kleuren', style: OFM + 'liberty' },
    bright: { label: 'Fris', note: 'Helder en contrastrijk, gele hoofdwegen', style: OFM + 'bright' },
    positron: { label: 'Licht', note: 'Rustig en licht, de route springt eruit', style: OFM + 'positron' },
    omreis: {
      label: 'Omreis 3D', note: 'Gekanteld met gebouwen in 3D, rustig en licht', style: OFM + 'positron', pitch: 45,
      tweak: m => { recolor(m, { land: '#F7F5FC', water: '#BCD0FF', green: '#DFF0C2', built: '#F7F5FC', building: '#ECE7F8', rail: '#CFC6EA', road: '#FFFFFF', text: '#4A4170' }); declutter(m, '#E0D6FF'); buildings3d(m, '#E4DCF7', 0.92); }
    },
    nacht: {
      label: 'Nacht 3D', note: 'Donker met gebouwen in 3D, lichtgevende route', style: OFM + 'dark', pitch: 45,
      tweak: m => { recolor(m, { land: '#150E33', water: '#0B0720', green: '#1A1B3C', built: '#150E33', building: '#1E1548', rail: '#3A2E7A', road: '#2A2060', roadEdge: '#150E33', text: '#CFC3FF' }); declutter(m, '#3A2E7A'); buildings3d(m, '#2C2068', 0.95); }
    },
    luchtfoto: { label: 'Luchtfoto', note: 'Echte luchtfoto van Nederland met namen erover', style: OFM + 'positron', pitch: 0, tweak: aerial },
    fiord: { label: 'Fjord', note: 'Diepblauw en ingetogen', style: OFM + 'fiord' }
  };
  // Nederlandse plaatsnamen en grotere letters, leesbaar op een telefoon.
  const K = 1.3;
  function bigger(v) {
    if (typeof v === 'number') return v * K;
    if (Array.isArray(v) && (v[0] === 'interpolate' || v[0] === 'step')) return v.map((x, i) => i >= (v[0] === 'step' ? 2 : 4) && i % 2 === 0 && typeof x === 'number' ? x * K : x);
    if (v && Array.isArray(v.stops)) return { ...v, stops: v.stops.map(s => [s[0], typeof s[1] === 'number' ? s[1] * K : s[1]]) };
    return v;
  }
  window.OMREIS_MAP_NL = map => map.getStyle().layers.forEach(l => {
    if (l.type !== 'symbol' || !l.layout || !l.layout['text-field'] || l.source !== 'openmaptiles') return;
    try {
      map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:nl'], ['get', 'name']]);
      if (l.layout['text-size'] !== undefined) map.setLayoutProperty(l.id, 'text-size', bigger(l.layout['text-size']));
    } catch (e) { /* laag laat zich niet aanpassen */ }
  });
})();
