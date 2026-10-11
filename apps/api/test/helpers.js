import { randomUUID } from 'node:crypto';
import { distanceKm, ACTIVE_TRIP_STATUSES } from '@pick/shared';
import { createApp } from '../src/app.js';
import { createOtpService } from '../src/auth/otp.js';
import { createTokens } from '../src/auth/tokens.js';
import { createDispatch } from '../src/trips/dispatch.js';
import { ActiveTripConflict } from '../src/trips/repo.js';

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
  const drivers = new Map(); // userId -> { approved, online, location, vehicleMake, vehiclePlate }
  const trips = new Map();
  const offers = new Map(); // tripId -> Set(driverId)
  const copy = (t) => (t ? structuredClone(t) : null);
  const isActive = (t) => ACTIVE_TRIP_STATUSES.includes(t.status);

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
        drivers.set(user.id, { approved: false, online: false, location: null, vehicleMake: null, vehiclePlate: null });
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
      return { userId, name: user?.name ?? null, ...d };
    },
    async setStatus(userId, { online, location }) {
      const d = drivers.get(userId);
      d.online = online;
      if (location) d.location = location;
    },
    async nearby(point, { radiusKm, limit }) {
      const busy = new Set([...trips.values()].filter((t) => t.driverId && isActive(t)).map((t) => t.driverId));
      return [...drivers.entries()]
        .filter(([id, d]) => d.online && d.approved && d.location && !busy.has(id))
        .map(([id, d]) => ({ driverId: id, ...d.location, distanceKm: distanceKm(point, d.location) }))
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
      if ([...trips.values()].some((t) => t.driverId === driverId && isActive(t))) throw new ActiveTripConflict();
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
