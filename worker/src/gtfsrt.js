// Kleine lezer voor GTFS-realtime (protobuf), zonder externe bibliotheken.
// Haalt per voertuig alleen op wat de app nodig heeft: rit, lijn, positie, richting, tijdstip.

function reader(buf) {
  let pos = 0;
  const varint = () => {
    let res = 0, shift = 0, b;
    do { b = buf[pos++]; res += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
    return res;
  };
  return {
    done: () => pos >= buf.length,
    // geeft [veldnummer, type, waarde]; waarde is een getal of een stuk bytes
    next() {
      const key = varint(), field = Math.floor(key / 8), type = key & 7;
      if (type === 0) return [field, type, varint()];
      if (type === 2) { const len = varint(); const v = buf.subarray(pos, pos + len); pos += len; return [field, type, v]; }
      if (type === 5) { const v = new DataView(buf.buffer, buf.byteOffset + pos, 4).getFloat32(0, true); pos += 4; return [field, type, v]; }
      if (type === 1) { const v = new DataView(buf.buffer, buf.byteOffset + pos, 8).getFloat64(0, true); pos += 8; return [field, type, v]; }
      throw new Error('onbekend veldtype ' + type);
    }
  };
}
const text = bytes => new TextDecoder().decode(bytes);

function tripDescriptor(bytes) {
  const r = reader(bytes), out = {};
  while (!r.done()) { const [f, , v] = r.next(); if (f === 1) out.tripId = text(v); else if (f === 5) out.routeId = text(v); else if (f === 3) out.startDate = text(v); }
  return out;
}
function position(bytes) {
  const r = reader(bytes), out = {};
  while (!r.done()) { const [f, , v] = r.next(); if (f === 1) out.lat = v; else if (f === 2) out.lon = v; else if (f === 3) out.bearing = v; else if (f === 5) out.speed = v; }
  return out;
}
function vehicleDescriptor(bytes) {
  const r = reader(bytes), out = {};
  while (!r.done()) { const [f, , v] = r.next(); if (f === 1) out.id = text(v); else if (f === 2) out.label = text(v); }
  return out;
}
function vehiclePosition(bytes) {
  const r = reader(bytes), out = {};
  while (!r.done()) {
    const [f, t, v] = r.next();
    if (f === 1) Object.assign(out, tripDescriptor(v));
    else if (f === 2) Object.assign(out, position(v));
    else if (f === 5 && t === 0) out.time = v;
    else if (f === 7) out.stopId = text(v);
    else if (f === 4 && t === 0) out.status = v;          // 0 komt aan, 1 staat stil bij halte, 2 onderweg
    else if (f === 8) out.vehicle = vehicleDescriptor(v).label || vehicleDescriptor(v).id;
  }
  return out;
}

/** Leest een GTFS-realtime FeedMessage en geeft de voertuigen terug. */
export function decodeVehicles(buf) {
  const r = reader(buf), list = [];
  while (!r.done()) {
    const [f, t, v] = r.next();
    if (f !== 2 || t !== 2) continue;                      // 2 = entity
    const e = reader(v);
    while (!e.done()) {
      const [ef, et, ev] = e.next();
      if (ef === 4 && et === 2) {                          // 4 = vehicle
        const veh = vehiclePosition(ev);
        if (veh.lat && veh.lon) list.push(veh);
      }
    }
  }
  return list;
}
