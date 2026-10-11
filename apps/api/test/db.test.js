// Runs the API against a real PostgreSQL + PostGIS database.
// Skipped unless TEST_DATABASE_URL points at a migrated database (CI sets it up).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { fakeNotifier, fakeSms, memoryStorage } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'set TEST_DATABASE_URL to run database tests' };

let ctx;
let db;
let drivers;

before(async () => {
  if (!url) return;
  process.env.DATABASE_URL = url;
  const [{ db: pool }, { createApp }, { createOtpService }, { pgOtpStore }, { createTokens },
    { pgUsersRepo }, { pgDriversRepo }, { pgTripsRepo }, { createDispatch },
    { pgPaymentsRepo }, { testProvider }, { createPayments }, { pgAdminRepo },
    { pgDocumentsRepo }, { createDocuments }] = await Promise.all([
    import('../src/db/pool.js'), import('../src/app.js'), import('../src/auth/otp.js'),
    import('../src/auth/otpStore.js'), import('../src/auth/tokens.js'), import('../src/users/repo.js'),
    import('../src/drivers/repo.js'), import('../src/trips/repo.js'), import('../src/trips/dispatch.js'),
    import('../src/payments/repo.js'), import('../src/payments/providers.js'), import('../src/payments/service.js'),
    import('../src/admin/repo.js'), import('../src/documents/repo.js'), import('../src/documents/service.js'),
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
  const testCheckout = testProvider({ publicUrl: 'http://pick.test' });
  const payments = createPayments({
    repo: pgPaymentsRepo(db), providers: { paystack: testCheckout, stripe: testCheckout, test: testCheckout },
    notifier, publicUrl: 'http://pick.test', emailDomain: 'riders.pick.invalid',
  });
  const dispatch = createDispatch({ trips, drivers, users, payments, notifier });
  // Road routes go through a midpoint 5 km east of the start (see `at` below)
  const routing = { route: async (from, to) => ({ points: [from, { lat: 5.6, lng: -0.25 + 5 / 110.6 }, to] }) };
  ctx = {
    app: createApp({
      deps: {
        otp, users, tokens, drivers, trips, dispatch, routing, payments, testCheckout, admin: pgAdminRepo(db),
        documents: createDocuments({ repo: pgDocumentsRepo(db), storage: memoryStorage() }),
      },
    }),
    sms, notifier, dispatch, tokens,
  };
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
    .send({ ...ride, pickup: at(2), driverId: kofi.id, paymentMethod: 'app' }).expect(201);
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

  // Esi chose to pay in the app: pending until she pays on the checkout page
  assert.equal(done.body.payment.status, 'pending');
  assert.equal(done.body.payment.amount, done.body.trip.fareFinal);
  await request(ctx.app).post('/trips').set('Authorization', esi.auth).send({ ...ride, driverId: yaw.id }).expect(402);
  const checkout = await request(ctx.app).post(`/trips/${esiTrip}/pay`).set('Authorization', esi.auth).expect(200);
  await request(ctx.app).post(new URL(checkout.body.checkoutUrl).pathname).expect(303);
  const paid = await request(ctx.app).get(`/trips/${esiTrip}/payment`).set('Authorization', esi.auth).expect(200);
  assert.equal(paid.body.payment.status, 'paid');
  assert.ok(paid.body.payment.paidAt);
  const earnings = await request(ctx.app).get('/drivers/me/earnings').set('Authorization', kofi.auth).expect(200);
  assert.equal(earnings.body.balance.owedToDriver, paid.body.payment.amount - paid.body.payment.commission);
  assert.equal(earnings.body.balance.balance, paid.body.payment.amount - paid.body.payment.commission);
  assert.equal(earnings.body.currency, 'GHS');

  // The admin dashboard sees all of it
  const { rows: [adminUser] } = await db().query(
    `INSERT INTO users (phone, country, role, name) VALUES ('+233249999999', 'GH', 'admin', 'Kingsley') RETURNING *`,
  );
  const adminAuth = `Bearer ${ctx.tokens.sign(adminUser)}`;
  const adminGet = (path) => request(ctx.app).get(path).set('Authorization', adminAuth).expect(200);
  const overview = (await adminGet('/admin/overview?days=1')).body;
  assert.deepEqual(overview.drivers, { pending: 0, approved: 2, online: 2 });
  assert.equal(overview.riders, 2);
  assert.deepEqual(overview.trips, { cancelled: 1, completed: 1 });
  assert.equal(overview.money[0].currency, 'GHS');
  assert.equal(overview.money[0].appPaid, paid.body.payment.amount);
  assert.equal(overview.money[0].commission, paid.body.payment.commission);
  const listed = (await adminGet('/admin/trips?status=completed')).body.trips;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].rider.name, 'Esi');
  assert.equal(listed[0].driver.name, 'Kofi');
  assert.equal(listed[0].paymentStatus, 'paid');
  assert.equal((await adminGet('/admin/trips?country=DE')).body.trips.length, 0);
  // Kofi uploads his licence twice; the admin rejects the first and approves the second
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
  const uploadLicence = async () => (await request(ctx.app).put('/drivers/me/documents/licence')
    .set('Authorization', kofi.auth).set('Content-Type', 'image/jpeg').send(jpeg).expect(201)).body.document;
  const darkLicence = await uploadLicence();
  await request(ctx.app).post(`/admin/documents/${darkLicence.id}/review`).set('Authorization', adminAuth)
    .send({ status: 'rejected', reason: 'Too dark' }).expect(200);
  const clearLicence = await uploadLicence();
  await request(ctx.app).post(`/admin/documents/${clearLicence.id}/review`).set('Authorization', adminAuth)
    .send({ status: 'approved' }).expect(200);
  const kofiDocs = (await adminGet(`/admin/drivers/${kofi.id}/documents`)).body;
  assert.equal(kofiDocs.checklist[0].document.status, 'approved');
  assert.deepEqual(kofiDocs.history.map((d) => d.status), ['approved', 'rejected']);
  const file = await request(ctx.app).get(`/admin/documents/${darkLicence.id}/file`).set('Authorization', adminAuth).expect(200);
  assert.ok(Buffer.from(file.body).equals(jpeg));

  const searched = (await adminGet('/admin/drivers?q=GR%201234')).body.drivers;
  assert.deepEqual([searched[0].documentsApproved, searched[0].documentsPending, searched[0].documentsRequired], [1, 0, 4]);
  assert.deepEqual(searched.map((d) => [d.name, d.rides, d.balance]), [['Kofi', 1, earnings.body.balance.balance]]);

  // Pick pays Kofi what Esi paid in the app: his balance goes to zero
  const owed = (await adminGet('/admin/balances')).body.balances;
  assert.deepEqual(owed.map((b) => [b.name, b.balance]), [['Kofi', earnings.body.balance.balance]]);
  await request(ctx.app).post('/admin/settlements').set('Authorization', adminAuth)
    .send({ driverId: kofi.id, direction: 'to_driver', amount: owed[0].balance, reference: 'MoMo 0001' }).expect(201);
  assert.deepEqual((await adminGet('/admin/balances')).body.balances, []);
  const settled = (await adminGet(`/admin/settlements?driverId=${kofi.id}`)).body.settlements;
  assert.deepEqual(settled.map((x) => [x.driverName, x.recordedBy, x.currency]), [['Kofi', 'Kingsley', 'GHS']]);

  // Suspending a driver takes them offline and stops them going back online
  await request(ctx.app).post(`/admin/drivers/${yaw.id}/approval`).set('Authorization', adminAuth)
    .send({ approved: false }).expect(200);
  await status(yaw, { location: at(1.5), mode: 'anywhere' }).expect(403);
  assert.equal((await adminGet('/admin/drivers?status=pending')).body.drivers[0].name, 'Yaw');

  const freed = await request(ctx.app).get('/drivers/me').set('Authorization', kofi.auth).expect(200);
  assert.deepEqual(freed.body.driver.load, { bookings: 0, seatsUsed: 0, hasSolo: false });

  // Going offline (Yaw was suspended above) hides the driver but keeps their last location
  const { rows } = await db().query('SELECT online, location IS NOT NULL AS has FROM drivers WHERE user_id = $1', [yaw.id]);
  assert.deepEqual(rows[0], { online: false, has: true });
});
