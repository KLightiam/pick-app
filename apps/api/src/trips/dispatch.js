import { canTransition, getMarket, splitFares, MATCH_DEFAULTS } from '@pick/shared';
import { ActiveTripConflict, NoRoomConflict } from './repo.js';
import { evaluateDriver, findRideOptions } from './options.js';

export const DISPATCH_DEFAULTS = Object.freeze({
  offerTimeoutMs: 60_000, // how long the chosen driver has to accept
  match: MATCH_DEFAULTS,
  now: () => new Date(),
});

export class DispatchError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// What a driver sees in an offer: no rider phone number or name until they accept.
const offerView = (trip) => ({
  id: trip.id,
  pickup: trip.pickup,
  dropoff: trip.dropoff,
  alight: trip.alight,
  pickupAddress: trip.pickupAddress,
  dropoffAddress: trip.dropoffAddress,
  rideType: trip.rideType,
  seats: trip.seats,
  matchType: trip.matchType,
  fareEstimate: trip.fareEstimate,
  currency: trip.currency,
});

/**
 * Ride requests: a passenger looks at the drivers who can take them
 * (`options`), picks one, and that driver gets the request to accept.
 * Unanswered requests are cancelled after `offerTimeoutMs` so the passenger
 * can pick someone else.
 */
export function createDispatch({ trips, drivers, users, notifier, options = {} }) {
  const opts = { ...DISPATCH_DEFAULTS, ...options, match: { ...MATCH_DEFAULTS, ...options.match } };
  const timers = new Map();

  const clearTimer = (tripId) => {
    clearTimeout(timers.get(tripId));
    timers.delete(tripId);
  };

  const closeOffers = async (tripId, exceptDriverId) => {
    for (const driverId of await trips.listOfferedDrivers(tripId)) {
      if (driverId !== exceptDriverId) notifier.toUser(driverId, 'trip:offer_closed', { tripId });
    }
  };

  // Positions are times in ms: who was in the car, and for how long.
  const fareFor = async (trip, now) => {
    const ms = (t) => new Date(t).getTime();
    const end = (t) => (t.id === trip.id || !t.completedAt ? ms(now) : ms(t.completedAt));
    const rides = await trips.ridesOverlapping(trip.driverId, { from: trip.startedAt, to: now });
    if (!rides.some((t) => t.id === trip.id)) rides.push(trip);
    const passengers = rides.map((t) => ({
      id: t.id,
      startKm: ms(t.startedAt),
      endKm: Math.max(end(t), ms(t.startedAt) + 1), // a ride always lasts at least 1 ms
      usual: t.usualFare ?? t.fareEstimate,
      seats: t.seats,
    }));
    return splitFares({ driverMode: trip.driverMode, passengers })[trip.id];
  };

  const expire = async (tripId) => {
    timers.delete(tripId);
    try {
      const trip = await trips.cancel(tripId, { from: 'requested', by: 'system', reason: 'no_driver_accepted' });
      if (!trip) return; // accepted or cancelled in the meantime
      notifier.toUser(trip.riderId, 'trip:cancelled', { trip });
      await closeOffers(tripId);
    } catch (err) {
      console.error('dispatch expire', err);
    }
  };

  return {
    /** Drivers who can take this ride, best match first, with prices. */
    async options(rider, request) {
      return findRideOptions({ drivers }, rider, request, opts.match);
    },

    async requestRide(rider, request) {
      const { driverId, pickup, dropoff, pickupAddress, dropoffAddress, rideType, seats } = request;
      if (await trips.findActiveForRider(rider.id)) {
        throw new DispatchError(409, 'You already have an active trip');
      }
      const driver = driverId !== rider.id ? await drivers.findById(driverId) : null;
      const option = driver?.online && driver.approved
        ? evaluateDriver(driver, request, getMarket(rider.country), opts.match)
        : null;
      if (!option) throw new DispatchError(409, 'That driver can no longer take this ride. Please choose another.');

      let trip;
      try {
        trip = await trips.create({
          riderId: rider.id, pickup, dropoff, pickupAddress, dropoffAddress, rideType, seats,
          alight: option.alight, remainingKm: option.remainingKm,
          driverMode: option.driverMode, matchType: option.matchType,
          fareEstimate: option.fare.max, usualFare: option.fare.usual, currency: option.fare.currency,
        });
      } catch (err) {
        if (err instanceof ActiveTripConflict) throw new DispatchError(409, 'You already have an active trip');
        throw err;
      }

      await trips.addOffers(trip.id, [driverId]);
      const expiresAt = new Date(Date.now() + opts.offerTimeoutMs).toISOString();
      notifier.toUser(driverId, 'trip:offer', { trip: offerView(trip), expiresAt });

      const timer = setTimeout(() => expire(trip.id), opts.offerTimeoutMs);
      timer.unref?.();
      timers.set(trip.id, timer);

      return { trip, fare: option.fare, expiresAt };
    },

    async accept(driver, tripId) {
      const current = await trips.findById(tripId);
      if (!current || !(await trips.wasOffered(tripId, driver.id))) {
        throw new DispatchError(404, 'Trip not found');
      }
      if (current.status !== 'requested') throw new DispatchError(409, 'This ride is no longer available');

      let trip;
      try {
        trip = await trips.accept(tripId, driver.id);
      } catch (err) {
        if (err instanceof NoRoomConflict) throw new DispatchError(409, 'Your car has no room for this booking');
        throw err;
      }
      if (!trip) throw new DispatchError(409, 'This ride is no longer available');

      clearTimer(tripId);
      const profile = await drivers.findById(driver.id);
      notifier.toUser(trip.riderId, 'trip:accepted', {
        trip,
        driver: {
          id: driver.id,
          name: profile?.name ?? null,
          vehicleMake: profile?.vehicleMake ?? null,
          vehiclePlate: profile?.vehiclePlate ?? null,
        },
      });
      await closeOffers(tripId, driver.id);
      const rider = await users.findById(trip.riderId);
      return { trip, rider: { id: rider.id, name: rider.name, phone: rider.phone } };
    },

    async cancel(user, tripId, reason) {
      const current = await trips.findById(tripId);
      const isRider = current?.riderId === user.id;
      const isDriver = current?.driverId != null && current.driverId === user.id;
      if (!isRider && !isDriver) throw new DispatchError(404, 'Trip not found');
      if (!canTransition(current.status, 'cancelled')) {
        throw new DispatchError(409, 'This trip can no longer be cancelled');
      }

      const trip = await trips.cancel(tripId, { from: current.status, by: isRider ? 'rider' : 'driver', reason });
      if (!trip) throw new DispatchError(409, 'This trip changed. Refresh and try again.');

      clearTimer(tripId);
      const other = isRider ? trip.driverId : trip.riderId;
      if (other) notifier.toUser(other, 'trip:cancelled', { trip });
      if (current.status === 'requested') await closeOffers(tripId);
      return trip;
    },

    /** Driver progress: 'arrived' at the pickup, or 'in_progress' once the passenger is in the car. */
    async advance(driver, tripId, to) {
      const current = await trips.findById(tripId);
      if (current?.driverId !== driver.id) throw new DispatchError(404, 'Trip not found');
      if (!canTransition(current.status, to)) throw new DispatchError(409, `This trip is ${current.status.replace('_', ' ')}`);
      const trip = await trips.advance(tripId, { from: current.status, to, at: opts.now() });
      if (!trip) throw new DispatchError(409, 'This trip changed. Refresh and try again.');
      notifier.toUser(trip.riderId, 'trip:status', { trip });
      return trip;
    },

    /**
     * Driver dropped the passenger off. The final fare splits each stretch of
     * the ride between whoever was in the car at the time, and is never more
     * than the price quoted at booking. After a partway ride, `nextLeg` is the
     * rest of the journey for the passenger to book.
     */
    async complete(driver, tripId) {
      const current = await trips.findById(tripId);
      if (current?.driverId !== driver.id) throw new DispatchError(404, 'Trip not found');
      if (current.status !== 'in_progress') throw new DispatchError(409, `This trip is ${current.status.replace('_', ' ')}`);

      const now = opts.now();
      const fareFinal = Math.min(current.fareEstimate, await fareFor(current, now));
      const trip = await trips.complete(tripId, { at: now, fareFinal });
      if (!trip) throw new DispatchError(409, 'This trip changed. Refresh and try again.');

      const nextLeg = trip.matchType === 'partial'
        ? { pickup: trip.alight, dropoff: trip.dropoff, dropoffAddress: trip.dropoffAddress, remainingKm: trip.remainingKm }
        : null;
      notifier.toUser(trip.riderId, 'trip:completed', { trip, nextLeg });
      return { trip, nextLeg };
    },

    /** Stops pending expiry timers (for shutdown and tests). */
    close() {
      for (const id of timers.keys()) clearTimer(id);
    },
  };
}
