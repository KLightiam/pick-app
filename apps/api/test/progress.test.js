import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { testApp } from './helpers.js';

const KM = 1 / 110.6;
const at = (east, north = 0) => ({ lat: 5.6 + north * KM, lng: -0.25 + east * KM });

let phoneSeq = 243000000;
async function makeUser(ctx, role, name) {
  const user = await ctx.users.create({ phone: `+233${phoneSeq++}`, country: 'GH', role, name });
  return { ...user, auth: `Bearer ${ctx.tokens.sign(user)}` };
}

/** A test app whose clock only moves when told: ctx.minutes(5) */
function clockApp() {
  let now = new Date('2026-10-12T07:00:00Z');
  const ctx = testApp({ dispatchOptions: { now: () => new Date(now) } });
  ctx.minutes = (m) => { now = new Date(now.getTime() + m * 60_000); };
  return ctx;
}

async function onlineDriver(ctx, status) {
  const driver = await makeUser(ctx, 'driver', 'Kofi');
  ctx.drivers.drivers.get(driver.id).approved = true;
  await request(ctx.app).post('/drivers/me/status').set('Authorization', driver.auth)
    .send({ online: true, ...status }).expect(200);
  return driver;
}

const post = (ctx, user, path, body) => request(ctx.app).post(path).set('Authorization', user.auth).send(body);

/** Books, accepts, arrives and picks up. Returns the trip id. */
async function rideStarted(ctx, driver, rider, ride) {
  const { body } = await post(ctx, rider, '/trips', { driverId: driver.id, ...ride }).expect(201);
  await post(ctx, driver, `/trips/${body.trip.id}/accept`).expect(200);
  await post(ctx, driver, `/trips/${body.trip.id}/arrived`).expect(200);
  await post(ctx, driver, `/trips/${body.trip.id}/start`).expect(200);
  return body.trip.id;
}

test('a trip goes accepted, arrived, in progress, completed, and the rider hears each step', async (t) => {
  const ctx = clockApp();
  t.after(() => ctx.dispatch.close());
  const driver = await onlineDriver(ctx, { location: at(0), mode: 'anywhere' });
  const rider = await makeUser(ctx, 'rider');
  const { body } = await post(ctx, rider, '/trips', { driverId: driver.id, pickup: at(1), dropoff: at(6) }).expect(201);
  const id = body.trip.id;

  await post(ctx, driver, `/trips/${id}/arrived`).expect(404); // not their trip until they accept
  await post(ctx, driver, `/trips/${id}/accept`).expect(200);
  await post(ctx, driver, `/trips/${id}/start`).expect(409); // must arrive first
  await post(ctx, driver, `/trips/${id}/complete`).expect(409);
  const arrived = await post(ctx, driver, `/trips/${id}/arrived`).expect(200);
  assert.equal(arrived.body.trip.status, 'arrived');
  assert.ok(arrived.body.trip.arrivedAt);
  ctx.minutes(2);
  const started = await post(ctx, driver, `/trips/${id}/start`).expect(200);
  assert.equal(started.body.trip.status, 'in_progress');
  await post(ctx, rider, `/trips/${id}/cancel`).expect(409); // can't cancel once in the car
  ctx.minutes(12);
  const done = await post(ctx, driver, `/trips/${id}/complete`).expect(200);
  assert.equal(done.body.trip.status, 'completed');
  assert.equal(done.body.trip.fareFinal, body.trip.fareEstimate); // alone with a go-anywhere driver: the usual fare
  assert.equal(done.body.nextLeg, null);

  const events = ctx.notifier.eventsFor(rider.id).map((e) => e.event);
  assert.deepEqual(events, ['trip:accepted', 'trip:status', 'trip:status', 'trip:completed']);
});

test('only the trip\'s driver can move it along', async (t) => {
  const ctx = clockApp();
  t.after(() => ctx.dispatch.close());
  const driver = await onlineDriver(ctx, { location: at(0), mode: 'anywhere' });
  const other = await onlineDriver(ctx, { location: at(0.1), mode: 'anywhere' });
  const rider = await makeUser(ctx, 'rider');
  const { body } = await post(ctx, rider, '/trips', { driverId: driver.id, pickup: at(1), dropoff: at(6) }).expect(201);
  await post(ctx, driver, `/trips/${body.trip.id}/accept`).expect(200);
  await post(ctx, other, `/trips/${body.trip.id}/arrived`).expect(404);
  await post(ctx, rider, `/trips/${body.trip.id}/arrived`).expect(403);
});

test('alone with a commuter, the final fare is 65% of the usual fare', async (t) => {
  const ctx = clockApp();
  t.after(() => ctx.dispatch.close());
  const driver = await onlineDriver(ctx, { location: at(0), mode: 'commute', destination: at(10), seatsOffered: 3 });
  const rider = await makeUser(ctx, 'rider');
  const id = await rideStarted(ctx, driver, rider, { pickup: at(1), dropoff: at(10), rideType: 'shared' });
  ctx.minutes(15);
  const { body } = await post(ctx, driver, `/trips/${id}/complete`).expect(200);
  const trip = ctx.trips.trips.get(id);
  assert.equal(body.trip.fareFinal, Math.round(trip.usualFare * 0.65));
});

test('sharing part of a commute lowers both fares', async (t) => {
  const ctx = clockApp();
  t.after(() => ctx.dispatch.close());
  const driver = await onlineDriver(ctx, { location: at(0), mode: 'commute', destination: at(20), seatsOffered: 3 });
  const ama = await makeUser(ctx, 'rider', 'Ama');
  const esi = await makeUser(ctx, 'rider', 'Esi');

  const amaTrip = await rideStarted(ctx, driver, ama, { pickup: at(1), dropoff: at(10), rideType: 'shared' });
  ctx.minutes(10);
  const esiTrip = await rideStarted(ctx, driver, esi, { pickup: at(5), dropoff: at(15), rideType: 'shared' });
  ctx.minutes(10);
  const amaDone = await post(ctx, driver, `/trips/${amaTrip}/complete`).expect(200);
  ctx.minutes(10);
  const esiDone = await post(ctx, driver, `/trips/${esiTrip}/complete`).expect(200);

  // Each was alone for half their ride (65%) and shared the other half (110% split two ways = 55%): 60% overall
  const usual = (id) => ctx.trips.trips.get(id).usualFare;
  assert.equal(amaDone.body.trip.fareFinal, Math.round(usual(amaTrip) * 0.6));
  assert.equal(esiDone.body.trip.fareFinal, Math.round(usual(esiTrip) * 0.6));
  assert.ok(amaDone.body.trip.fareFinal < amaDone.body.trip.fareEstimate);
});

test('a solo commuter ride is never charged more than quoted', async (t) => {
  const ctx = clockApp();
  t.after(() => ctx.dispatch.close());
  const driver = await onlineDriver(ctx, { location: at(0), mode: 'commute', destination: at(10) });
  const rider = await makeUser(ctx, 'rider');
  const id = await rideStarted(ctx, driver, rider, { pickup: at(1), dropoff: at(10) });
  ctx.minutes(90); // stuck in traffic
  const { body } = await post(ctx, driver, `/trips/${id}/complete`).expect(200);
  assert.equal(body.trip.fareFinal, body.trip.fareEstimate);
});

test('after a partway ride, the rider is offered the rest of the journey', async (t) => {
  const ctx = clockApp();
  t.after(() => ctx.dispatch.close());
  const driver = await onlineDriver(ctx, { location: at(0), mode: 'commute', destination: at(10) });
  const rider = await makeUser(ctx, 'rider');
  const ride = { pickup: at(1), dropoff: at(10, 4), dropoffAddress: 'Ashaiman' };
  const id = await rideStarted(ctx, driver, rider, ride);
  ctx.minutes(15);
  const { body } = await post(ctx, driver, `/trips/${id}/complete`).expect(200);

  assert.equal(body.trip.matchType, 'partial');
  assert.deepEqual(body.nextLeg.pickup, body.trip.alight);
  assert.deepEqual(body.nextLeg.dropoff, ride.dropoff);
  assert.equal(body.nextLeg.dropoffAddress, 'Ashaiman');
  assert.ok(body.nextLeg.remainingKm > 3);
  const pushed = ctx.notifier.eventsFor(rider.id, 'trip:completed')[0];
  assert.deepEqual(pushed.payload.nextLeg, body.nextLeg);

  // The rider is free to book that next leg straight away
  const next = await makeUser(ctx, 'driver');
  ctx.drivers.drivers.get(next.id).approved = true;
  await post(ctx, next, '/drivers/me/status', { online: true, location: body.nextLeg.pickup, mode: 'anywhere' }).expect(200);
  const options = await post(ctx, rider, '/trips/options', { pickup: body.nextLeg.pickup, dropoff: body.nextLeg.dropoff });
  assert.equal(options.body.options.length, 1);
  await post(ctx, rider, '/trips', { driverId: next.id, pickup: body.nextLeg.pickup, dropoff: body.nextLeg.dropoff })
    .expect(201);
});

test('a completed ride frees its seats', async (t) => {
  const ctx = clockApp();
  t.after(() => ctx.dispatch.close());
  const driver = await onlineDriver(ctx, { location: at(0), mode: 'commute', destination: at(10) });
  const first = await makeUser(ctx, 'rider');
  const second = await makeUser(ctx, 'rider');
  const id = await rideStarted(ctx, driver, first, { pickup: at(1), dropoff: at(5) });
  const busy = await post(ctx, second, '/trips/options', { pickup: at(6), dropoff: at(10) });
  assert.equal(busy.body.options.length, 0);
  ctx.minutes(8);
  await post(ctx, driver, `/trips/${id}/complete`).expect(200);
  const free = await post(ctx, second, '/trips/options', { pickup: at(6), dropoff: at(10) });
  assert.equal(free.body.options.length, 1);
});

test('GET /trips/active returns the rider\'s current trip and the driver\'s passengers', async (t) => {
  const ctx = clockApp();
  t.after(() => ctx.dispatch.close());
  const driver = await onlineDriver(ctx, { location: at(0), mode: 'commute', destination: at(10), seatsOffered: 2 });
  const rider = await makeUser(ctx, 'rider');
  const get = (user) => request(ctx.app).get('/trips/active').set('Authorization', user.auth);

  assert.deepEqual((await get(rider)).body.trips, []);
  const { body } = await post(ctx, rider, '/trips', { driverId: driver.id, pickup: at(1), dropoff: at(10), rideType: 'shared' })
    .expect(201);
  assert.equal((await get(rider)).body.trips[0].id, body.trip.id);
  assert.deepEqual((await get(driver)).body.trips, []); // not theirs until accepted
  await post(ctx, driver, `/trips/${body.trip.id}/accept`).expect(200);
  assert.equal((await get(driver)).body.trips[0].id, body.trip.id);
});
