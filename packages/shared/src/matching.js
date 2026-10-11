import { distanceKm } from './geo.js';
import { projectOntoRoute, routeLengthKm } from './route.js';

/**
 * How a driver can serve a passenger, best first:
 * - exact:    a commuter going to (nearly) the same place
 * - beyond:   a commuter passing the passenger's destination on the way further
 * - partial:  a commuter heading that way who drops the passenger partway
 * - anywhere: a go-anywhere driver, like a normal taxi
 */
export const MATCH_TYPES = Object.freeze(['exact', 'beyond', 'partial', 'anywhere']);

export const MATCH_DEFAULTS = Object.freeze({
  pickupDetourKm: 1, // how far off a commuter's route a pickup can be
  dropoffDetourKm: 1, // how far off the route a drop-off can be and still count as "beyond"
  exactRadiusKm: 1, // destinations this close count as the same place
  anywhereRadiusKm: 5, // how far away a go-anywhere driver can be
  minProgress: 0.3, // a partway ride must cover at least 30% of the way
});

/**
 * Can a commuter driving `route` (from where they are now to their
 * destination) carry a passenger from `pickup` to `dropoff`?
 * Returns null, or { matchType, alight, pickupKm, alightKm, rideKm, remainingKm },
 * where pickupKm/alightKm are distances along the route and remainingKm is how
 * far the passenger still is from their destination after getting off.
 */
export function matchCommute(route, pickup, dropoff, options = {}) {
  const opts = { ...MATCH_DEFAULTS, ...options };
  const lengthKm = routeLengthKm(route);
  const p = projectOntoRoute(route, pickup);
  if (p.crossKm > opts.pickupDetourKm || p.alongKm >= lengthKm) return null;

  const result = (matchType, alight, alightKm) => ({
    matchType,
    alight,
    pickupKm: p.alongKm,
    alightKm,
    rideKm: distanceKm(pickup, alight),
    remainingKm: distanceKm(alight, dropoff),
  });

  const destination = route.at(-1);
  if (distanceKm(destination, dropoff) <= opts.exactRadiusKm) {
    return result('exact', dropoff, lengthKm);
  }

  const q = projectOntoRoute(route, dropoff, { minAlongKm: p.alongKm });
  if (q.alongKm <= p.alongKm) return null; // the destination is behind the pickup
  if (q.crossKm <= opts.dropoffDetourKm) return result('beyond', dropoff, q.alongKm);

  const progress = 1 - distanceKm(q.point, dropoff) / distanceKm(pickup, dropoff);
  if (progress >= opts.minProgress) return result('partial', q.point, q.alongKm);
  return null;
}

/** Can a go-anywhere driver at `driverLocation` take this ride? */
export function matchAnywhere(driverLocation, pickup, dropoff, options = {}) {
  const opts = { ...MATCH_DEFAULTS, ...options };
  const toPickupKm = distanceKm(driverLocation, pickup);
  if (toPickupKm > opts.anywhereRadiusKm) return null;
  return {
    matchType: 'anywhere',
    alight: dropoff,
    pickupKm: toPickupKm,
    alightKm: toPickupKm + distanceKm(pickup, dropoff),
    rideKm: distanceKm(pickup, dropoff),
    remainingKm: 0,
  };
}

/** Sorts options best first: by match type, then by how far the driver is from the pickup. */
export function rankMatches(options) {
  return [...options].sort(
    (a, b) => MATCH_TYPES.indexOf(a.matchType) - MATCH_TYPES.indexOf(b.matchType) || a.pickupKm - b.pickupKm,
  );
}
