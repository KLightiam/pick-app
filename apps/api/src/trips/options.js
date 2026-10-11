import {
  getMarket, matchAnywhere, matchCommute, quoteFare, rankMatches, usualFare, MATCH_DEFAULTS,
} from '@pick/shared';
import { hasRoom, seatsLeft } from './capacity.js';

/**
 * Works out whether one driver can take a ride request, and at what price.
 * Returns null, or an option the passenger can choose.
 */
export function evaluateDriver(driver, { pickup, dropoff, rideType, seats }, market, matchOptions = MATCH_DEFAULTS) {
  if (!hasRoom(driver, driver.load, { rideType, seats })) return null;
  const match = driver.mode === 'commute'
    ? driver.route && matchCommute(driver.route, pickup, dropoff, matchOptions)
    : driver.location && matchAnywhere(driver.location, pickup, dropoff, matchOptions);
  if (!match) return null;

  const usual = usualFare(pickup, match.alight, market.pricing);
  return {
    driverId: driver.userId,
    driver: { name: driver.name, vehicleMake: driver.vehicleMake, vehiclePlate: driver.vehiclePlate },
    driverMode: driver.mode,
    destinationAddress: driver.mode === 'commute' ? driver.destinationAddress : null,
    matchType: match.matchType,
    pickupKm: round1(match.pickupKm),
    rideKm: round1(match.rideKm),
    alight: match.alight,
    remainingKm: round1(match.remainingKm),
    seatsLeft: seatsLeft(driver, driver.load),
    fare: { ...quoteFare({ driverMode: driver.mode, usual, rideType }), usual, currency: market.currency },
  };
}

const round1 = (n) => Math.round(n * 10) / 10;

/** Every driver who can take this ride, best match first. */
export async function findRideOptions({ drivers }, rider, request, matchOptions = MATCH_DEFAULTS) {
  const market = getMarket(rider.country);
  const candidates = await drivers.candidates(request.pickup, matchOptions);
  const options = candidates
    .filter((d) => d.userId !== rider.id)
    .map((d) => evaluateDriver(d, request, market, matchOptions))
    .filter(Boolean);
  return rankMatches(options);
}
