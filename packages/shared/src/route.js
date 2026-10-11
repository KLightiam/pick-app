// Geometry along a driver's route: a polyline of { lat, lng } points.
// Uses a flat-earth projection, which is accurate to well under 1% at city scale.

const KM_PER_DEG_LAT = 110.574;
const kmPerDegLng = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180);

function toXY(p, lat0) {
  return { x: p.lng * kmPerDegLng(lat0), y: p.lat * KM_PER_DEG_LAT };
}

function fromXY({ x, y }, lat0) {
  return { lat: y / KM_PER_DEG_LAT, lng: x / kmPerDegLng(lat0) };
}

export function routeLengthKm(route) {
  const lat0 = route[0].lat;
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    const a = toXY(route[i - 1], lat0);
    const b = toXY(route[i], lat0);
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/**
 * Finds the point on the route closest to `p`, only looking at the part of
 * the route at or after `minAlongKm`.
 * Returns { point, alongKm, crossKm }: where on the route, how far along it,
 * and how far `p` is from it.
 */
export function projectOntoRoute(route, p, { minAlongKm = 0 } = {}) {
  const lat0 = route[0].lat;
  const q = toXY(p, lat0);
  let best = null;
  let walked = 0;
  for (let i = 1; i < route.length; i++) {
    const a = toXY(route[i - 1], lat0);
    const b = toXY(route[i], lat0);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const segEnd = walked + len;
    if (segEnd >= minAlongKm && len > 0) {
      let t = ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / (len * len);
      const tMin = Math.max(0, (minAlongKm - walked) / len);
      t = Math.min(1, Math.max(tMin, t));
      const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      const crossKm = Math.hypot(q.x - proj.x, q.y - proj.y);
      if (!best || crossKm < best.crossKm) {
        best = { point: fromXY(proj, lat0), alongKm: walked + t * len, crossKm };
      }
    }
    walked = segEnd;
  }
  if (!best) {
    // minAlongKm is past the end: the only candidate is the destination.
    const end = route.at(-1);
    const e = toXY(end, lat0);
    best = { point: end, alongKm: walked, crossKm: Math.hypot(q.x - e.x, q.y - e.y) };
  }
  return best;
}
