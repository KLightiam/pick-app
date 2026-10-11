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
  const drivers = pgDriversRepo(db);
  const trips = pgTripsRepo(db);
  const otp = createOtpService({ store: pgOtpStore(db), sms, secret: 'test-secret' });
  const dispatch = createDispatch({ trips, drivers, users, notifier });
  ctx = { app: createApp({ deps: { otp, users, tokens, drivers, trips, dispatch } }), sms, notifier, dispatch };
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

test('sign up, go online, request, accept and cancel a ride on a real database', opts, async () => {
  const rider = await signUp('+233241111111', 'rider', 'Ama');
  const driver = await signUp('+233242222222', 'driver', 'Kofi');
  const me = await request(ctx.app).get('/auth/me').set('Authorization', rider.auth).expect(200);
  assert.equal(me.body.user.country, 'GH');

  // New drivers wait for approval
  const location = { lat: 5.61, lng: -0.187 };
  await request(ctx.app).post('/drivers/me/status').set('Authorization', driver.auth)
    .send({ online: true, location }).expect(403);
  await db().query('UPDATE drivers SET approved = true WHERE user_id = $1', [driver.id]);
  await request(ctx.app).post('/drivers/me/status').set('Authorization', driver.auth)
    .send({ online: true, location }).expect(200);

  const nearby = await request(ctx.app).get('/drivers/nearby?lat=5.6037&lng=-0.187').expect(200);
  assert.equal(nearby.body.drivers.length, 1);
  assert.ok(Math.abs(nearby.body.drivers[0].distanceKm - 0.7) < 0.1);
  assert.ok(Math.abs(nearby.body.drivers[0].lat - 5.61) < 1e-9);

  const pickup = { lat: 5.6037, lng: -0.187 };
  const dropoff = { lat: 5.65, lng: -0.17 };
  const created = await request(ctx.app).post('/trips').set('Authorization', rider.auth)
    .send({ pickup, dropoff, pickupAddress: 'Osu' }).expect(201);
  const trip = created.body.trip;
  assert.equal(trip.status, 'requested');
  assert.equal(trip.currency, 'GHS');
  assert.deepEqual(trip.pickup, pickup);
  assert.equal(created.body.driversOffered, 1);

  await request(ctx.app).post('/trips').set('Authorization', rider.auth).send({ pickup, dropoff }).expect(409);

  const accepted = await request(ctx.app).post(`/trips/${trip.id}/accept`).set('Authorization', driver.auth)
    .expect(200);
  assert.equal(accepted.body.trip.driverId, driver.id);
  assert.equal(accepted.body.rider.phone, '+233241111111');

  // A busy driver no longer shows as available
  const busy = await request(ctx.app).get('/drivers/nearby?lat=5.6037&lng=-0.187').expect(200);
  assert.equal(busy.body.drivers.length, 0);

  const seen = await request(ctx.app).get(`/trips/${trip.id}`).set('Authorization', driver.auth).expect(200);
  assert.equal(seen.body.trip.status, 'accepted');

  const cancelled = await request(ctx.app).post(`/trips/${trip.id}/cancel`).set('Authorization', rider.auth)
    .send({ reason: 'plans changed' }).expect(200);
  assert.equal(cancelled.body.trip.cancelledBy, 'rider');
  assert.equal(cancelled.body.trip.cancelReason, 'plans changed');

  // After cancelling, the rider can request again
  await request(ctx.app).post('/trips').set('Authorization', rider.auth).send({ pickup, dropoff }).expect(201);

  // Going offline hides the driver but keeps their last location
  await request(ctx.app).post('/drivers/me/status').set('Authorization', driver.auth)
    .send({ online: false }).expect(200);
  const offline = await request(ctx.app).get('/drivers/nearby?lat=5.6037&lng=-0.187').expect(200);
  assert.equal(offline.body.drivers.length, 0);
  const { rows } = await db().query('SELECT location IS NOT NULL AS has FROM drivers WHERE user_id = $1', [driver.id]);
  assert.equal(rows[0].has, true);
});
