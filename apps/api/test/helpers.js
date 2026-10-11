import { randomUUID } from 'node:crypto';
import { distanceKm, projectOntoRoute, ACTIVE_TRIP_STATUSES } from '@pick/shared';
import { createApp } from '../src/app.js';
import { createOtpService } from '../src/auth/otp.js';
import { createTokens } from '../src/auth/tokens.js';
import { createDispatch } from '../src/trips/dispatch.js';
import { ActiveTripConflict, NoRoomConflict } from '../src/trips/repo.js';
import { hasRoom } from '../src/trips/capacity.js';

export function memoryOtpStore() {
  const rows = [];
  let nextId = 1;
  return {
    rows,
    async countSince(phone, since) {
      return rows.filter((r) => r.phone === phone && r.createdAt > since).length;
    },
    async create({ phone, codeHash, expiresAt }) {
      rows.push({ id: nextId++, phone, codeHash, expiresAt, attempts: 0, usedAt: null, createdAt: new Date() });
    },
    async latestActive(phone, at) {
      return rows.filter((r) => r.phone === phone && !r.usedAt && r.expiresAt > at).at(-1) ?? null;
    },
    async addAttempt(id) {
      rows.find((r) => r.id === id).attempts++;
    },
    async markUsed(id, at) {
      rows.find((r) => r.id === id).usedAt = at;
    },
  };
}

/** In-memory stand-ins for the Postgres repos, sharing one set of tables. */
export function memoryDb() {
  const users = [];
  const drivers = new Map(); // userId -> driver row
  const trips = new Map();
  const offers = new Map(); // tripId -> Set(driverId)
  const copy = (t) => (t ? structuredClone(t) : null);
  const isActive = (t) => ACTIVE_TRIP_STATUSES.includes(t.status);
  const isAssigned = (t) => ['accepted', 'arrived', 'in_progress'].includes(t.status);

  const loadOf = (driverId) => {
    const active = [...trips.values()].filter((t) => t.driverId === driverId && isAssigned(t));
    return {
      bookings: active.length,
      seatsUsed: active.reduce((sum, t) => sum + t.seats, 0),
      hasSolo: active.some((t) => t.rideType === 'solo'),
    };
  };

  const usersRepo = {
    users,
    async findByPhone(phone) {
      return users.find((u) => u.phone === phone) ?? null;
    },
    async findById(id) {
      return users.find((u) => u.id === id) ?? null;
    },
    async create({ phone, country, role, name }) {
      const user = { id: randomUUID(), phone, country, role, name: name ?? null };
      users.push(user);
      if (role === 'driver') {
        drivers.set(user.id, {
          approved: false, online: false, location: null, vehicleMake: null, vehiclePlate: null,
          seats: 4, mode: 'anywhere', seatsOffered: 1, destination: null, destinationAddress: null, route: null,
        });
      }
      return user;
    },
  };

  const driversRepo = {
    drivers,
    async findById(userId) {
      const d = drivers.get(userId);
      if (!d) return null;
      const user = users.find((u) => u.id === userId);
      return structuredClone({ userId, name: user?.name ?? null, ...d, load: loadOf(userId) });
    },
    async updateVehicle(userId, { vehicleMake, vehiclePlate, seats }) {
      const d = drivers.get(userId);
      Object.assign(d, { vehicleMake: vehicleMake ?? null, vehiclePlate: vehiclePlate ?? null, seats });
      d.seatsOffered = Math.min(d.seatsOffered, seats);
    },
    async setStatus(userId, status) {
      const d = drivers.get(userId);
      if (!status.online) {
        d.online = false;
        return;
      }
      const commute = status.mode === 'commute';
      Object.assign(d, {
        online: true, location: status.location, mode: status.mode, seatsOffered: status.seatsOffered,
        destination: commute ? status.destination : null,
        destinationAddress: commute ? status.destinationAddress ?? null : null,
        route: commute ? [status.location, status.destination] : null,
      });
    },
    async updateLocation(userId, location) {
      const d = drivers.get(userId);
      d.location = location;
      if (d.mode === 'commute' && d.destination) d.route = [location, d.destination];
    },
    async candidates(pickup, { anywhereRadiusKm, pickupDetourKm }) {
      const nearRoute = (route) => projectOntoRoute(route, pickup).crossKm <= pickupDetourKm;
      const ids = [...drivers.entries()]
        .filter(([, d]) => d.online && d.approved && d.location)
        .filter(([, d]) => (d.mode === 'anywhere'
          ? distanceKm(d.location, pickup) <= anywhereRadiusKm
          : d.route && nearRoute(d.route)))
        .map(([id]) => id);
      return Promise.all(ids.map((id) => driversRepo.findById(id)));
    },
    async nearby(point, { radiusKm, limit }) {
      return [...drivers.entries()]
        .filter(([id, d]) => {
          const load = loadOf(id);
          return d.online && d.approved && d.location && !load.hasSolo && load.seatsUsed < d.seatsOffered;
        })
        .map(([id, d]) => ({ driverId: id, mode: d.mode, ...d.location, distanceKm: distanceKm(point, d.location) }))
        .filter((d) => d.distanceKm <= radiusKm)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, limit);
    },
  };

  const tripsRepo = {
    trips,
    async findById(id) {
      return copy(trips.get(id));
    },
    async findActiveForRider(riderId) {
      return copy([...trips.values()].find((t) => t.riderId === riderId && isActive(t)));
    },
    async create(input) {
      if ([...trips.values()].some((t) => t.riderId === input.riderId && isActive(t))) {
        throw new ActiveTripConflict();
      }
      const trip = {
        id: randomUUID(), driverId: null, status: 'requested',
        pickupAddress: null, dropoffAddress: null, ...input,
        requestedAt: new Date().toISOString(), acceptedAt: null,
        cancelledAt: null, cancelledBy: null, cancelReason: null,
      };
      trips.set(trip.id, trip);
      return copy(trip);
    },
    async addOffers(tripId, driverIds) {
      offers.set(tripId, new Set([...(offers.get(tripId) ?? []), ...driverIds]));
    },
    async listOfferedDrivers(tripId) {
      return [...(offers.get(tripId) ?? [])];
    },
    async wasOffered(tripId, driverId) {
      return offers.get(tripId)?.has(driverId) ?? false;
    },
    async accept(tripId, driverId) {
      const trip = trips.get(tripId);
      if (trip?.status !== 'requested') return null;
      if (!hasRoom(drivers.get(driverId), loadOf(driverId), trip)) throw new NoRoomConflict();
      Object.assign(trip, { driverId, status: 'accepted', acceptedAt: new Date().toISOString() });
      return copy(trip);
    },
    async cancel(tripId, { from, by, reason }) {
      const trip = trips.get(tripId);
      if (trip?.status !== from) return null;
      Object.assign(trip, {
        status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: by, cancelReason: reason ?? null,
      });
      return copy(trip);
    },
  };

  return { users: usersRepo, drivers: driversRepo, trips: tripsRepo };
}

/** Records texts instead of sending them; lastCode(phone) reads the code back. */
export function fakeSms() {
  const sent = [];
  return {
    sent,
    async send(to, body) {
      sent.push({ to, body });
    },
    lastCode(to) {
      return sent.filter((m) => m.to === to).at(-1)?.body.match(/\d{6}/)[0];
    },
  };
}

/** Records pushed events; eventsFor(userId) lists them. */
export function fakeNotifier() {
  const events = [];
  return {
    events,
    toUser(userId, event, payload) {
      events.push({ userId, event, payload });
    },
    eventsFor(userId, event) {
      return events.filter((e) => e.userId === userId && (!event || e.event === event));
    },
  };
}

export function testApp({ now, dispatchOptions } = {}) {
  const sms = fakeSms();
  const store = memoryOtpStore();
  const notifier = fakeNotifier();
  const { users, drivers, trips } = memoryDb();
  const tokens = createTokens({ secret: 'test-secret', expiresIn: '1h' });
  const otp = createOtpService({ store, sms, secret: 'test-secret', now });
  const dispatch = createDispatch({ trips, drivers, users, notifier, options: dispatchOptions });
  const app = createApp({ deps: { otp, users, tokens, drivers, trips, dispatch } });
  return { app, sms, store, users, drivers, trips, tokens, notifier, dispatch };
}
