const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Straight-line distance in km between two { lat, lng } points. */
export function distanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function isValidPoint(p) {
  return (
    p != null &&
    Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 &&
    Number.isFinite(p.lng) && Math.abs(p.lng) <= 180
  );
}
