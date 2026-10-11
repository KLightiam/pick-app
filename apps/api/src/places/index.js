// Address search for the apps, using Photon: open-source geocoding on OpenStreetMap data.
// The public server at photon.komoot.io is fine for development; run your own for production.

const label = (p) => {
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const parts = [p.name, street !== p.name ? street : null, p.district, p.city ?? p.town ?? p.village, p.state];
  return [...new Set(parts.filter(Boolean))].join(', ');
};

export function photonGeocoder({ baseUrl, fetchFn = fetch, timeoutMs = 5000 }) {
  return {
    /** Places matching `query` in `country` (GH or DE), nearest to `near` first when given. */
    async search(query, { country, near, limit = 6 }) {
      const params = new URLSearchParams({ q: query, limit: String(limit * 3) });
      if (near) {
        params.set('lat', String(near.lat));
        params.set('lon', String(near.lng));
      }
      const res = await fetchFn(`${baseUrl.replace(/\/$/, '')}/api/?${params}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`Photon responded ${res.status}`);
      const body = await res.json();
      return (body.features ?? [])
        .filter((f) => !country || f.properties?.countrycode?.toUpperCase() === country)
        .slice(0, limit)
        .map((f) => ({
          name: f.properties.name ?? label(f.properties),
          address: label(f.properties),
          location: { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] },
        }));
    },
  };
}

export function createGeocoder({ url }) {
  return photonGeocoder({ baseUrl: url });
}
