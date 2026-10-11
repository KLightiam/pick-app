import { randomUUID } from 'node:crypto';
import { distanceKm, driverBalance, projectOntoRoute, ACTIVE_TRIP_STATUSES } from '@pick/shared';
import { createApp } from '../src/app.js';
import { createOtpService } from '../src/auth/otp.js';
import { createTokens } from '../src/auth/tokens.js';
import { createDispatch } from '../src/trips/dispatch.js';
import { straightRouter } from '../src/routing/index.js';
import { ActiveTripConflict, NoRoomConflict } from '../src/trips/repo.js';
import { hasRoom } from '../src/trips/capacity.js';
import { testProvider } from '../src/payments/providers.js';
import { createPayments } from '../src/payments/service.js';
import { createDocuments } from '../src/documents/service.js';

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
        route: commute ? status.route : null,
      });
    },
    async updateLocation(userId, location) {
      drivers.get(userId).location = location;
    },
    async setRoute(userId, route) {
      const d = drivers.get(userId);
      if (d.mode === 'commute') d.route = route;
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
    async findActiveForDriver(driverId) {
      return [...trips.values()].filter((t) => t.driverId === driverId && isAssigned(t)).map(copy);
    },
    async create(input) {
      if ([...trips.values()].some((t) => t.riderId === input.riderId && isActive(t))) {
        throw new ActiveTripConflict();
      }
      const trip = {
        id: randomUUID(), driverId: null, status: 'requested',
        pickupAddress: null, dropoffAddress: null, paymentMethod: 'cash', ...input,
        requestedAt: new Date().toISOString(), acceptedAt: null, arrivedAt: null, startedAt: null,
        completedAt: null, fareFinal: null,
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
    async advance(tripId, { from, to, at }) {
      const trip = trips.get(tripId);
      if (trip?.status !== from) return null;
      trip.status = to;
      trip[{ arrived: 'arrivedAt', in_progress: 'startedAt' }[to]] = at.toISOString();
      return copy(trip);
    },
    async complete(tripId, { at, fareFinal }) {
      const trip = trips.get(tripId);
      if (trip?.status !== 'in_progress') return null;
      Object.assign(trip, { status: 'completed', completedAt: at.toISOString(), fareFinal });
      return copy(trip);
    },
    async ridesOverlapping(driverId, { from, to }) {
      return [...trips.values()]
        .filter((t) => t.driverId === driverId && ['in_progress', 'completed'].includes(t.status))
        .filter((t) => new Date(t.startedAt) < to && (!t.completedAt || new Date(t.completedAt) > new Date(from)))
        .map(copy);
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

  const payments = new Map();
  const paymentsRepo = {
    payments,
    async create(p) {
      const existing = [...payments.values()].find((x) => x.tripId === p.tripId);
      if (existing) return copy(existing);
      const row = {
        id: randomUUID(), ...p, providerRef: null, checkoutUrl: null, createdAt: new Date(), paidAt: null,
      };
      payments.set(row.id, row);
      return copy(row);
    },
    async findByTrip(tripId) {
      return copy([...payments.values()].find((x) => x.tripId === tripId));
    },
    async findByRef(ref) {
      return copy([...payments.values()].find((x) => x.providerRef === ref));
    },
    async findById(id) {
      return copy(payments.get(id));
    },
    async findUnpaidForRider(riderId) {
      return copy([...payments.values()].find((x) => x.riderId === riderId && x.status === 'pending'));
    },
    async setCheckout(id, { providerRef, checkoutUrl }) {
      const row = payments.get(id);
      if (row?.status !== 'pending') return null;
      Object.assign(row, { providerRef, checkoutUrl });
      return copy(row);
    },
    async markPaid(id, at) {
      const row = payments.get(id);
      if (row?.status !== 'pending') return null;
      Object.assign(row, { status: 'paid', paidAt: at });
      return copy(row);
    },
    settlements: [],
    async balanceFor(driverId) {
      const mine = [...payments.values()].filter((x) => x.driverId === driverId);
      const settled = paymentsRepo.settlements.filter((x) => x.driverId === driverId);
      if (!mine.length && !settled.length) return null;
      return { currency: (mine[0] ?? settled[0]).currency, ...driverBalance(mine, settled) };
    },
    async listForDriver(driverId, { since }) {
      return [...payments.values()]
        .filter((x) => x.driverId === driverId && x.createdAt >= since)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(copy);
    },
  };

  const documents = new Map();
  const documentsRepo = {
    documents,
    async create(d) {
      const row = {
        id: randomUUID(), ...d, status: 'pending', uploadedAt: new Date(Date.now() + documents.size).toISOString(),
        reviewedBy: null, reviewedAt: null, rejectReason: null,
      };
      documents.set(row.id, row);
      return copy(row);
    },
    async findById(id) {
      return copy(documents.get(id));
    },
    async listForDriver(driverId) {
      return [...documents.values()].filter((d) => d.driverId === driverId)
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).map(copy);
    },
    async review(id, { status, by, reason }) {
      const row = documents.get(id);
      if (row?.status !== 'pending') return null;
      Object.assign(row, {
        status, reviewedBy: by, reviewedAt: new Date().toISOString(), rejectReason: status === 'rejected' ? reason : null,
      });
      return copy(row);
    },
  };

  return { users: usersRepo, drivers: driversRepo, trips: tripsRepo, payments: paymentsRepo, documents: documentsRepo };
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

/** Keeps uploaded files in memory. */
export function memoryStorage() {
  const files = new Map();
  return {
    files,
    async put(key, bytes, contentType) { files.set(key, { bytes: Buffer.from(bytes), contentType }); },
    async get(key) { return files.get(key) ?? null; },
    async remove(key) { files.delete(key); },
  };
}

/** Finds places from a fixed list; `fail: true` simulates the service being down. */
export function fakeGeocoder(places = [], { fail = false } = {}) {
  return {
    async search(query) {
      if (fail) throw new Error('down');
      return places.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));
    },
  };
}

export function testApp({
  now, dispatchOptions, routing = straightRouter(), geocoder = fakeGeocoder(), providers: customProviders, admin,
  storage = memoryStorage(),
} = {}) {
  const sms = fakeSms();
  const store = memoryOtpStore();
  const notifier = fakeNotifier();
  const { users, drivers, trips, payments: paymentsRepo, documents: documentsRepo } = memoryDb();
  const documents = createDocuments({ repo: documentsRepo, storage });
  const tokens = createTokens({ secret: 'test-secret', expiresIn: '1h' });
  const otp = createOtpService({ store, sms, secret: 'test-secret', now });
  const testCheckout = testProvider({ publicUrl: 'http://pick.test' });
  const providers = { paystack: testCheckout, stripe: testCheckout, test: testCheckout, ...customProviders };
  const payments = createPayments({
    repo: paymentsRepo, providers, notifier, publicUrl: 'http://pick.test', emailDomain: 'riders.pick.invalid',
  });
  const dispatch = createDispatch({ trips, drivers, users, payments, notifier, options: dispatchOptions });
  const app = createApp({
    deps: { otp, users, tokens, drivers, trips, dispatch, routing, geocoder, payments, testCheckout, admin, documents },
  });
  return {
    app, sms, store, users, drivers, trips, tokens, notifier, dispatch, routing, payments, paymentsRepo, testCheckout,
    documents, documentsRepo, storage,
  };
}
