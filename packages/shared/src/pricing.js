import { estimateFare } from './fare.js';

/**
 * Commuters are driving anyway, so passengers only help cover fuel:
 * - alone with a commuter: 65% of the usual fare for their distance
 * - sharing with a commuter: together, 110% of the usual fare (the driver earns a little extra)
 * - with a go-anywhere driver: the usual fare, split between whoever shares
 */
export const PRICE_RULES = Object.freeze({
  commuteSoloShare: 0.65,
  commuteSharedTotal: 1.1,
  anywhereSharedTotal: 1.0,
});

/** What a ride of this length would normally cost in this market, in minor units. */
export function usualFare(from, to, pricing) {
  return estimateFare(from, to, pricing).fare;
}

/** Total paid for a stretch of road, as a share of its usual fare, when `bookings` share it. */
function stretchMultiplier(driverMode, bookings, rules) {
  if (driverMode === 'anywhere') return rules.anywhereSharedTotal;
  return bookings === 1 ? rules.commuteSoloShare : rules.commuteSharedTotal;
}

/**
 * The price shown at booking: the most the passenger will pay, which is the
 * price if nobody else joins. `ifShared` is what it drops to if one other
 * passenger shares the whole way (only for shared rides).
 */
export function quoteFare({ driverMode, usual, rideType }, rules = PRICE_RULES) {
  const max = Math.round(usual * stretchMultiplier(driverMode, 1, rules));
  if (rideType !== 'shared') return { max };
  return { max, ifShared: Math.round((usual * stretchMultiplier(driverMode, 2, rules)) / 2) };
}

/**
 * Final fares for everyone who rode with one driver. Each passenger's usual
 * fare is spread evenly over their ride; every stretch of road is then split
 * between the bookings in the car at that time (by seats), at the multiplier
 * for that many bookings.
 *
 * passengers: [{ id, startKm, endKm, usual, seats = 1 }] with positions along the driver's route.
 * Returns { [id]: fare } in minor units.
 */
export function splitFares({ driverMode, passengers }, rules = PRICE_RULES) {
  const stops = [...new Set(passengers.flatMap((p) => [p.startKm, p.endKm]))].sort((a, b) => a - b);
  const owed = Object.fromEntries(passengers.map((p) => [p.id, 0]));

  for (let i = 1; i < stops.length; i++) {
    const [from, to] = [stops[i - 1], stops[i]];
    const aboard = passengers.filter((p) => p.startKm <= from && p.endKm >= to);
    if (aboard.length === 0) continue;
    const seats = aboard.reduce((sum, p) => sum + (p.seats ?? 1), 0);
    const multiplier = stretchMultiplier(driverMode, aboard.length, rules);
    for (const p of aboard) {
      const usualForStretch = (p.usual * (to - from)) / (p.endKm - p.startKm);
      owed[p.id] += (usualForStretch * multiplier * (p.seats ?? 1)) / seats;
    }
  }
  return Object.fromEntries(Object.entries(owed).map(([id, fare]) => [id, Math.round(fare)]));
}
