// Road routes for commuters: the roads from where a driver is to where they're going.
// OSRM is open-source routing on OpenStreetMap data. Its public demo server is
// fine for development; in production, run your own OSRM server (see README).

/** A straight line. Used when routing is turned off or unavailable. */
export function straightRouter() {
  return {
    async route(from, to) {
      return { points: [from, to], source: 'straight' };
    },
  };
}

export function osrmRouter({ baseUrl, fetchFn = fetch, timeoutMs = 5000 }) {
  return {
    async route(from, to) {
      const url = `${baseUrl.replace(/\/$/, '')}/route/v1/driving/`
        + `${from.lng},${from.lat};${to.lng},${to.lat}?overview=simplified&geometries=geojson`;
      const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`OSRM responded ${res.status}`);
      const body = await res.json();
      const best = body.routes?.[0];
      if (body.code !== 'Ok' || !best) throw new Error(`OSRM found no route: ${body.code}`);
      return {
        points: best.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
        distanceKm: best.distance / 1000,
        durationMin: best.duration / 60,
        source: 'osrm',
      };
    },
  };
}

/** Uses `primary`, and falls back to a straight line if it fails, so drivers can always go online. */
export function withFallback(primary, fallback = straightRouter(), log = console) {
  return {
    async route(from, to) {
      try {
        return await primary.route(from, to);
      } catch (err) {
        log.warn?.(`routing failed, using a straight line: ${err.message}`);
        return fallback.route(from, to);
      }
    },
  };
}

export function createRouting({ provider, osrmUrl }) {
  if (provider === 'straight') return straightRouter();
  return withFallback(osrmRouter({ baseUrl: osrmUrl }));
}
