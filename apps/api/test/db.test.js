// Runs the API against a real PostgreSQL + PostGIS database.
// Skipped unless TEST_DATABASE_URL points at a migrated database (CI sets it up).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { fakeNotifier, fakeSms } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'set TEST_DATABASE_URL to run database tests' };

let ctx;
let db;
let drivers;

before(async () => {
  if (!url) return;
  process.env.DATABASE_URL = url;
  const [{ db: pool }, { createApp }, { createOtpService }, { pgOtpStore }, { createTokens },
    { pgUsersRepo }, { pgDriversRepo }, { pgTripsRepo }, { createDispatch }] = await Promise.all([
    import('../src/db/pool.js'), import('../src/app.js'), import('../src/auth/otp.js'),
    import('../src/auth/otpStore.js'), import('../src/auth/tokens.js'), import('../src/users/repo.js'),
    import('../src/drivers/repo.js'), import('../src/trips/repo.js'), import('../src/trips/dispatch.js'),
  ]);
  db = pool;
  await db().query('TRUNCATE users, otp_codes CASCADE');
  const sms = fakeSms();
  const notifier = fakeNotifier();
  const tokens = createTokens({ secret: 'test-secret', expiresIn: '1h' });
  const users = pgUsersRepo(db);
  drivers = pgDriversRepo(db);
  const trips = pgTripsRepo(db);
  const otp = createOtpService({ store: pgOtpStore(db), sms, secret: 'test-secret' });
  const dispatch = createDispatch({ trips, drivers, users, notifier });
  // Road routes go through a midpoint 5 km east of the start (see `at` below)
  const routing = { route: async (from, to) => ({ points: [from, { lat: 5.6, lng: -0.25 + 5 / 110.6 }, to] }) };
  ctx = { app: createApp({ deps: { otp, users, tokens, drivers, trips, dispatch, routing } }), sms, notifier, dispatch };
});

after(async () => {
  if (!url) return;
  ctx.dispatch.close();
  const { closeDb } = await import('../src/db/pool.js');
  await closeDb();
});

async function signUp(phone, role, name) {
  await request(ctx.app).post('/auth/code').send({ phone }).expect(204);
  const res = await request(ctx.app).post('/auth/verify')
    .send({ phone, code: ctx.sms.lastCode(phone), role, name }).expect(200);
  return { ...res.body.user, auth: `Bearer ${res.body.token}` };
}

const KM = 1 / 110.6;
const at = (east, north = 0) => ({ lat: 5.6 + north * KM, lng: -0.25 + east * KM });

test('commuter and go-anywhere rides, solo and shared, on a real database', opts, async () => {
  const ama = await signUp('+233241111111', 'rider', 'Ama');
  const esi = await signUp('+233241111112', 'rider', 'Esi');
  const kofi = await signUp('+233242222222', 'driver', 'Kofi');
  const yaw = await signUp('+233242222223', 'driver', 'Yaw');
  const me = await request(ctx.app).get('/auth/me').set('Authorization', ama.auth).expect(200);
  assert.equal(me.body.user.country, 'GH');

  const status = (driver, body) => request(ctx.app).post('/drivers/me/status').set('Authorization', driver.auth)
    .send({ online: true, ...body });

  // New drivers wait for approval
  await status(kofi, { location: at(0), mode: 'commute', destination: at(10) }).expect(403);
  await db().query('UPDATE drivers SET approved = true');

  await request(ctx.app).put('/drivers/me/vehicle').set('Authorization', kofi.auth)
    .send({ vehicleMake: 'Toyota Corolla', vehiclePlate: 'GR 1234-24', seats: 4 }).expect(200);
  await status(kofi, { location: at(0), mode: 'commute', destination: at(10), destinationAddress: 'Tema', seatsOffered: 2 })
    .expect(200);
  await status(yaw, { location: at(1.5), mode: 'anywhere' }).expect(200);

  const profile = await request(ctx.app).get('/drivers/me').set('Authorization', kofi.auth).expect(200);
  assert.equal(profile.body.driver.mode, 'commute');
  assert.equal(profile.body.driver.route.length, 3);
  assert.ok(Math.abs(profile.body.driver.route[2].lng - at(10).lng) < 1e-9);
  assert.deepEqual(profile.body.driver.load, { bookings: 0, seatsUsed: 0, hasSolo: false });

  const nearby = await request(ctx.app).get(`/drivers/nearby?lat=${at(1).lat}&lng=${at(1).lng}`).expect(200);
  assert.equal(nearby.body.drivers.length, 2);

  const ride = { pickup: at(1), dropoff: at(10), rideType: 'shared' };
  const found = await request(ctx.app).post('/trips/options').set('Authorization', ama.auth).send(ride).expect(200);
  assert.deepEqual(found.body.options.map((o) => [o.driver.name, o.matchType]), [['Kofi', 'exact'], ['Yaw', 'anywhere']]);
  const [kofiOption] = found.body.options;
  assert.equal(kofiOption.destinationAddress, 'Tema');
  assert.equal(kofiOption.fare.max, Math.round(kofiOption.fare.usual * 0.65));

  // Ama and Esi both share Kofi's commute
  const first = await request(ctx.app).post('/trips').set('Authorization', ama.auth)
    .send({ ...ride, driverId: kofi.id, pickupAddress: 'Osu' }).expect(201);
  const trip = first.body.trip;
  assert.equal(trip.rideType, 'shared');
  assert.equal(trip.matchType, 'exact');
  assert.equal(trip.currency, 'GHS');
  assert.ok(Math.abs(trip.pickup.lat - at(1).lat) < 1e-9);
  assert.deepEqual(trip.alight, trip.dropoff);
  await request(ctx.app).post('/trips').set('Authorization', ama.auth).send({ ...ride, driverId: kofi.id }).expect(409);
  await request(ctx.app).post(`/trips/${trip.id}/accept`).set('Authorization', kofi.auth).expect(200);

  const second = await request(ctx.app).post('/trips').set('Authorization', esi.auth)
    .send({ ...ride, pickup: at(2), driverId: kofi.id }).expect(201);
  const accepted = await request(ctx.app).post(`/trips/${second.body.trip.id}/accept`).set('Authorization', kofi.auth)
    .expect(200);
  assert.equal(accepted.body.rider.phone, '+233241111112');

  // Kofi's two shared seats are now full
  const after = await request(ctx.app).get('/drivers/me').set('Authorization', kofi.auth).expect(200);
  assert.deepEqual(after.body.driver.load, { bookings: 2, seatsUsed: 2, hasSolo: false });
  const stillFree = await request(ctx.app).get(`/drivers/nearby?lat=${at(1).lat}&lng=${at(1).lng}`).expect(200);
  assert.deepEqual(stillFree.body.drivers.map((d) => d.driverId), [yaw.id]);

  // Moving updates the location; a new route replaces the old one
  await drivers.updateLocation(kofi.id, at(3));
  await drivers.setRoute(kofi.id, [at(3), at(6, 1), at(10)]);
  const moved = await request(ctx.app).get('/drivers/me').set('Authorization', kofi.auth).expect(200);
  assert.ok(Math.abs(moved.body.driver.location.lng - at(3).lng) < 1e-9);
  assert.equal(moved.body.driver.route.length, 3);
  assert.ok(Math.abs(moved.body.driver.route[1].lat - at(6, 1).lat) < 1e-9);

  const cancelled = await request(ctx.app).post(`/trips/${trip.id}/cancel`).set('Authorization', ama.auth)
    .send({ reason: 'plans changed' }).expect(200);
  assert.equal(cancelled.body.trip.cancelledBy, 'rider');
  assert.equal(cancelled.body.trip.cancelReason, 'plans changed');

  // Esi's ride runs to the end, alone after Ama cancelled: 65% of the usual fare
  const esiTrip = second.body.trip.id;
  await request(ctx.app).post(`/trips/${esiTrip}/arrived`).set('Authorization', kofi.auth).expect(200);
  const started = await request(ctx.app).post(`/trips/${esiTrip}/start`).set('Authorization', kofi.auth).expect(200);
  assert.ok(started.body.trip.startedAt);
  await new Promise((r) => setTimeout(r, 20));
  const done = await request(ctx.app).post(`/trips/${esiTrip}/complete`).set('Authorization', kofi.auth).expect(200);
  assert.equal(done.body.trip.status, 'completed');
  assert.ok(done.body.trip.completedAt);
  assert.equal(done.body.trip.fareFinal, Math.round(done.body.trip.usualFare * 0.65));
  assert.equal(done.body.nextLeg, null);
  const freed = await request(ctx.app).get('/drivers/me').set('Authorization', kofi.auth).expect(200);
  assert.deepEqual(freed.body.driver.load, { bookings: 0, seatsUsed: 0, hasSolo: false });

  // Going offline hides the driver but keeps their last location
  await request(ctx.app).post('/drivers/me/status').set('Authorization', yaw.auth).send({ online: false }).expect(200);
  const { rows } = await db().query('SELECT online, location IS NOT NULL AS has FROM drivers WHERE user_id = $1', [yaw.id]);
  assert.deepEqual(rows[0], { online: false, has: true });
});
