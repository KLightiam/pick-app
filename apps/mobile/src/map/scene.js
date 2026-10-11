// What the live map shows, worked out from the trip. Kept apart from the map itself so it can be tested.
// A scene is { markers: [{ id, kind, lat, lng }], line: [{ lat, lng }] | null, fitKey }.
// kind: 'pickup' | 'dropoff' | 'car' | 'me'. The map re-centres on everything whenever fitKey changes,
// and otherwise just moves the markers, so it doesn't jump while someone is looking around.

const ON_THE_WAY = ['accepted', 'arrived', 'in_progress'];
const isPoint = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);

function scene(markers, line = null) {
  const shown = markers.filter((m) => isPoint(m));
  return {
    markers: shown.map(({ id, kind, lat, lng }) => ({ id, kind, lat, lng })),
    line: line?.filter(isPoint).length > 1 ? line.filter(isPoint).map(({ lat, lng }) => ({ lat, lng })) : null,
    fitKey: shown.map((m) => m.id).sort().join(','),
  };
}

/** The rider's trip: where they're picked up and dropped off, and the driver's car once one is coming. */
export function riderScene(trip, driverAt) {
  const markers = [
    { id: 'pickup', kind: 'pickup', ...trip.pickup },
    { id: 'dropoff', kind: 'dropoff', ...(trip.alight ?? trip.dropoff) }, // a partway ride ends where the driver turns off
  ];
  if (ON_THE_WAY.includes(trip.status) && driverAt) markers.push({ id: 'car', kind: 'car', ...driverAt });
  return scene(markers);
}

/** The driver's map: where they are, each passenger's next stop, and a commuter's road to their destination. */
export function driverScene({ me, trips = [], route = null }) {
  const markers = [];
  if (me) markers.push({ id: 'me', kind: 'car', ...me });
  for (const t of trips) {
    markers.push(t.status === 'in_progress'
      ? { id: `${t.id}:dropoff`, kind: 'dropoff', ...(t.alight ?? t.dropoff) }
      : { id: `${t.id}:pickup`, kind: 'pickup', ...t.pickup });
  }
  return scene(markers, route);
}
