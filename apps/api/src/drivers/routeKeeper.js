import { trimRoute } from '@pick/shared';

export const ROUTE_KEEPER_DEFAULTS = Object.freeze({
  offRouteKm: 0.5, // re-route a commuter who is this far from their route
  minIntervalMs: 60_000, // but not more than once a minute
});

/**
 * Keeps commuters' routes up to date as they drive: when a commuter leaves
 * their route (took another road), it asks for a new route from where they are.
 */
export function createRouteKeeper({ drivers, routing, options = {}, now = () => Date.now() }) {
  const opts = { ...ROUTE_KEEPER_DEFAULTS, ...options };
  const lastRerouted = new Map();

  return {
    /** Call after saving a driver's new location. Resolves to true if it re-routed. */
    async onLocation(userId, location) {
      const driver = await drivers.findById(userId);
      if (driver?.mode !== 'commute' || !driver.route || !driver.destination) return false;
      if (trimRoute(driver.route, location).offRouteKm < opts.offRouteKm) return false;
      if (now() - (lastRerouted.get(userId) ?? -Infinity) < opts.minIntervalMs) return false;

      lastRerouted.set(userId, now());
      const { points } = await routing.route(location, driver.destination);
      await drivers.setRoute(userId, points);
      return true;
    },
  };
}
