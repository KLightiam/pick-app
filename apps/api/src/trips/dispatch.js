import { canTransition, estimateFare, getMarket } from '@pick/shared';
import { ActiveTripConflict } from './repo.js';

export const DISPATCH_DEFAULTS = Object.freeze({
  searchRadiusKm: 5,
  maxOffers: 5, // offer each request to the 5 nearest drivers; the first to accept gets it
  offerTimeoutMs: 60_000,
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
  pickupAddress: trip.pickupAddress,
  dropoffAddress: trip.dropoffAddress,
  fareEstimate: trip.fareEstimate,
  currency: trip.currency,
});

/**
 * Ride requests: a rider asks for a ride, the nearest drivers get an offer,
 * and the first driver to accept is assigned. Unanswered requests are
 * cancelled after `offerTimeoutMs`.
 */
export function createDispatch({ trips, drivers, users, notifier, options = {} }) {
  const opts = { ...DISPATCH_DEFAULTS, ...options };
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
    async requestRide(rider, { pickup, dropoff, pickupAddress, dropoffAddress }) {
      const market = getMarket(rider.country);
      if (await trips.findActiveForRider(rider.id)) {
        throw new DispatchError(409, 'You already have an active trip');
      }
      const nearby = await drivers.nearby(pickup, { radiusKm: opts.searchRadiusKm, limit: opts.maxOffers });
      if (nearby.length === 0) throw new DispatchError(409, 'No drivers nearby. Try again in a moment.');

      const { fare } = estimateFare(pickup, dropoff, market.pricing);
      let trip;
      try {
        trip = await trips.create({
          riderId: rider.id, pickup, dropoff, pickupAddress, dropoffAddress,
          fareEstimate: fare, currency: market.currency,
        });
      } catch (err) {
        if (err instanceof ActiveTripConflict) throw new DispatchError(409, 'You already have an active trip');
        throw err;
      }

      const driverIds = nearby.map((d) => d.driverId);
      await trips.addOffers(trip.id, driverIds);
      const expiresAt = new Date(Date.now() + opts.offerTimeoutMs).toISOString();
      for (const id of driverIds) notifier.toUser(id, 'trip:offer', { trip: offerView(trip), expiresAt });

      const timer = setTimeout(() => expire(trip.id), opts.offerTimeoutMs);
      timer.unref?.();
      timers.set(trip.id, timer);

      return { trip, driversOffered: driverIds.length, expiresAt };
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
        if (err instanceof ActiveTripConflict) throw new DispatchError(409, 'Finish your current trip first');
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

    /** Stops pending expiry timers (for shutdown and tests). */
    close() {
      for (const id of timers.keys()) clearTimer(id);
    },
  };
}
