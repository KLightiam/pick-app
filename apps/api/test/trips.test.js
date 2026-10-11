import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { testApp } from './helpers.js';

// Positions in km east/north of a point in Accra (1 km ≈ 1/110.6 degrees here).
const KM = 1 / 110.6;
const at = (east, north = 0) => ({ lat: 5.6 + north * KM, lng: -0.25 + east * KM });

let phoneSeq = 241000000;
async function makeUser(ctx, role, name) {
  const user = await ctx.users.create({ phone: `+233${phoneSeq++}`, country: 'GH', role, name });
  return { ...user, auth: `Bearer ${ctx.tokens.sign(user)}` };
}

/** An approved driver who goes online. status: { location, mode, destination, seatsOffered } */
async function onlineDriver(ctx, status, name = 'Kofi') {
  const driver = await makeUser(ctx, 'driver', name);
  ctx.drivers.drivers.get(driver.id).approved = true;
  await request(ctx.app).post('/drivers/me/status').set('Authorization', driver.auth)
    .send({ online: true, ...status }).expect(200);
  return driver;
}

const commuter = (ctx, east, destination, extra = {}, name) =>
  onlineDriver(ctx, { location: at(east), mode: 'commute', destination, ...extra }, name);
const anywhere = (ctx, east, extra = {}, name) => onlineDriver(ctx, { location: at(east), mode: 'anywhere', ...extra }, name);

const options = (ctx, rider, body) =>
  request(ctx.app).post('/trips/options').set('Authorization', rider.auth).send(body);
const book = (ctx, rider, body) => request(ctx.app).post('/trips').set('Authorization', rider.auth).send(body);
const accept = (ctx, driver, tripId) =>
  request(ctx.app).post(`/trips/${tripId}/accept`).set('Authorization', driver.auth);

test('options list commuters going exactly there, then beyond, then partway, then go-anywhere drivers', async () => {
  const ctx = testApp();
  const exact = await commuter(ctx, 0, at(10), {}, 'Exact');
  const beyond = await commuter(ctx, 0.5, at(20), {}, 'Beyond');
  const partial = await commuter(ctx, 0, at(7, 4), {}, 'Partway');
  const taxi = await anywhere(ctx, 1.5, {}, 'Taxi');
  await commuter(ctx, 0, at(-10), {}, 'Wrong way');
  const rider = await makeUser(ctx, 'rider', 'Ama');

  const res = await options(ctx, rider, { pickup: at(1), dropoff: at(10) });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.options.map((o) => o.driver.name), ['Exact', 'Beyond', 'Partway', 'Taxi']);
  assert.deepEqual(res.body.options.map((o) => o.matchType), ['exact', 'beyond', 'partial', 'anywhere']);
  assert.deepEqual(res.body.options.map((o) => o.driverId), [exact.id, beyond.id, partial.id, taxi.id]);

  const [e, , p, t] = res.body.options;
  // Commuters charge 65% of the usual fare; go-anywhere drivers charge the usual fare
  assert.equal(e.fare.max, Math.round(e.fare.usual * 0.65));
  assert.equal(t.fare.max, t.fare.usual);
  assert.equal(e.fare.currency, 'GHS');
  // The partway commuter drops the rider before the destination, priced only to that point
  assert.ok(p.remainingKm > 0);
  assert.ok(p.rideKm < e.rideKm);
  assert.ok(p.fare.usual < e.fare.usual);
});

test('shared requests show what the price could drop to', async () => {
  const ctx = testApp();
  await commuter(ctx, 0, at(10), { seatsOffered: 3 });
  const rider = await makeUser(ctx, 'rider');
  const [option] = (await options(ctx, rider, { pickup: at(1), dropoff: at(10), rideType: 'shared' })).body.options;
  assert.equal(option.fare.ifShared, Math.round((option.fare.usual * 1.1) / 2));
  assert.equal(option.seatsLeft, 3);
});

test('a passenger books the driver they chose, and only that driver gets the request', async (t) => {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  const chosen = await commuter(ctx, 0, at(10), {}, 'Kofi');
  const other = await anywhere(ctx, 1);
  const rider = await makeUser(ctx, 'rider', 'Ama');

  const res = await book(ctx, rider, { driverId: chosen.id, pickup: at(1), dropoff: at(10), pickupAddress: 'Osu' });
  assert.equal(res.status, 201);
  assert.equal(res.body.trip.status, 'requested');
  assert.equal(res.body.trip.matchType, 'exact');
  assert.equal(res.body.trip.driverMode, 'commute');
  assert.equal(res.body.trip.fareEstimate, res.body.fare.max);

  const offer = ctx.notifier.eventsFor(chosen.id, 'trip:offer')[0];
  assert.equal(offer.payload.trip.pickupAddress, 'Osu');
  assert.equal(offer.payload.trip.riderId, undefined, 'offers do not reveal the rider');
  assert.equal(ctx.notifier.eventsFor(other.id, 'trip:offer').length, 0);

  const accepted = await accept(ctx, chosen, res.body.trip.id);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.rider.name, 'Ama');
  assert.equal(ctx.notifier.eventsFor(rider.id, 'trip:accepted')[0].payload.driver.name, 'Kofi');
});

test('booking a driver who can no longer take the ride fails without creating a trip', async () => {
  const ctx = testApp();
  const wrongWay = await commuter(ctx, 0, at(-10));
  const rider = await makeUser(ctx, 'rider');
  const res = await book(ctx, rider, { driverId: wrongWay.id, pickup: at(1), dropoff: at(10) });
  assert.equal(res.status, 409);
  assert.equal(ctx.trips.trips.size, 0);
});

test('ride requests are validated', async () => {
  const ctx = testApp();
  const driver = await anywhere(ctx, 0);
  const rider = await makeUser(ctx, 'rider');
  const base = { driverId: driver.id, pickup: at(1), dropoff: at(5) };
  await book(ctx, rider, { ...base, driverId: undefined }).expect(400);
  await book(ctx, rider, { ...base, rideType: 'pool' }).expect(400);
  await book(ctx, rider, { ...base, seats: 0 }).expect(400);
  await book(ctx, rider, { ...base, pickup: { lat: 1 } }).expect(400);
  await book(ctx, driver, base).expect(403);
  await request(ctx.app).post('/trips').send(base).expect(401);
});

test('a solo booking takes the whole car', async (t) => {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  const driver = await commuter(ctx, 0, at(10), { seatsOffered: 3 });
  const solo = await makeUser(ctx, 'rider');
  const sharer = await makeUser(ctx, 'rider');

  const { body } = await book(ctx, solo, { driverId: driver.id, pickup: at(1), dropoff: at(10), rideType: 'solo' })
    .expect(201);
  await accept(ctx, driver, body.trip.id).expect(200);

  const res = await options(ctx, sharer, { pickup: at(2), dropoff: at(10), rideType: 'shared' });
  assert.equal(res.body.options.length, 0);
});

test('shared bookings fill the seats the driver chose to share, and no more', async (t) => {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  const driver = await commuter(ctx, 0, at(10), { seatsOffered: 2 });
  const [a, b, c] = [await makeUser(ctx, 'rider'), await makeUser(ctx, 'rider'), await makeUser(ctx, 'rider')];
  const ride = { driverId: driver.id, pickup: at(1), dropoff: at(10), rideType: 'shared' };

  const first = await book(ctx, a, ride).expect(201);
  await accept(ctx, driver, first.body.trip.id).expect(200);
  // One seat left: a solo ride is no longer possible, a shared one is
  assert.equal((await options(ctx, b, { ...ride, rideType: 'solo' })).body.options.length, 0);
  const [option] = (await options(ctx, b, ride)).body.options;
  assert.equal(option.seatsLeft, 1);

  const second = await book(ctx, b, ride).expect(201);
  const thirdAsk = await book(ctx, c, ride).expect(201); // booked before the second was accepted
  await accept(ctx, driver, second.body.trip.id).expect(200);
  const full = await accept(ctx, driver, thirdAsk.body.trip.id);
  assert.equal(full.status, 409);
  assert.equal((await options(ctx, c, ride)).body.options.length, 0);
});

test('a two-seat shared booking needs two free seats', async () => {
  const ctx = testApp();
  await commuter(ctx, 0, at(10), { seatsOffered: 1 });
  const rider = await makeUser(ctx, 'rider');
  const res = await options(ctx, rider, { pickup: at(1), dropoff: at(10), rideType: 'shared', seats: 2 });
  assert.equal(res.body.options.length, 0);
});

test('a rider can have only one active trip', async (t) => {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  const driver = await anywhere(ctx, 0);
  const rider = await makeUser(ctx, 'rider');
  await book(ctx, rider, { driverId: driver.id, pickup: at(1), dropoff: at(5) }).expect(201);
  await book(ctx, rider, { driverId: driver.id, pickup: at(1), dropoff: at(5) }).expect(409);
});

test('a driver who was not asked cannot accept the trip', async (t) => {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  const driver = await anywhere(ctx, 0);
  const outsider = await anywhere(ctx, 0.2);
  const rider = await makeUser(ctx, 'rider');
  const { body } = await book(ctx, rider, { driverId: driver.id, pickup: at(1), dropoff: at(5) }).expect(201);
  await accept(ctx, outsider, body.trip.id).expect(404);
  await accept(ctx, rider, body.trip.id).expect(403);
});

test('a rider can cancel a waiting request, which closes the driver\'s offer', async (t) => {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  const driver = await anywhere(ctx, 0);
  const rider = await makeUser(ctx, 'rider');
  const { body } = await book(ctx, rider, { driverId: driver.id, pickup: at(1), dropoff: at(5) }).expect(201);
  const res = await request(ctx.app).post(`/trips/${body.trip.id}/cancel`).set('Authorization', rider.auth)
    .send({ reason: 'changed my mind' });
  assert.equal(res.body.trip.cancelledBy, 'rider');
  assert.equal(ctx.notifier.eventsFor(driver.id, 'trip:offer_closed').length, 1);
  await accept(ctx, driver, body.trip.id).expect(409);
});

test('after accepting, either side can cancel and the other is told', async (t) => {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  const driver = await anywhere(ctx, 0);
  const rider = await makeUser(ctx, 'rider');
  const { body } = await book(ctx, rider, { driverId: driver.id, pickup: at(1), dropoff: at(5) }).expect(201);
  await accept(ctx, driver, body.trip.id).expect(200);
  const res = await request(ctx.app).post(`/trips/${body.trip.id}/cancel`).set('Authorization', driver.auth);
  assert.equal(res.body.trip.cancelledBy, 'driver');
  assert.equal(ctx.notifier.eventsFor(rider.id, 'trip:cancelled').length, 1);
  await request(ctx.app).post(`/trips/${body.trip.id}/cancel`).set('Authorization', rider.auth).expect(409);
});

test('only the trip\'s rider and driver can see or cancel it', async (t) => {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  const driver = await anywhere(ctx, 0);
  const rider = await makeUser(ctx, 'rider');
  const stranger = await makeUser(ctx, 'rider');
  const { body } = await book(ctx, rider, { driverId: driver.id, pickup: at(1), dropoff: at(5) }).expect(201);
  await request(ctx.app).get(`/trips/${body.trip.id}`).set('Authorization', rider.auth).expect(200);
  await request(ctx.app).get(`/trips/${body.trip.id}`).set('Authorization', stranger.auth).expect(404);
  await request(ctx.app).post(`/trips/${body.trip.id}/cancel`).set('Authorization', stranger.auth).expect(404);
  await request(ctx.app).get('/trips/not-a-uuid').set('Authorization', rider.auth).expect(404);
});

test('a request the driver doesn\'t answer is cancelled so the rider can choose again', async (t) => {
  const ctx = testApp({ dispatchOptions: { offerTimeoutMs: 20 } });
  t.after(() => ctx.dispatch.close());
  const driver = await anywhere(ctx, 0);
  const rider = await makeUser(ctx, 'rider');
  const { body } = await book(ctx, rider, { driverId: driver.id, pickup: at(1), dropoff: at(5) }).expect(201);
  await new Promise((r) => setTimeout(r, 60));
  const trip = ctx.trips.trips.get(body.trip.id);
  assert.equal(trip.status, 'cancelled');
  assert.equal(trip.cancelReason, 'no_driver_accepted');
  assert.equal(ctx.notifier.eventsFor(rider.id, 'trip:cancelled').length, 1);
  assert.equal(ctx.notifier.eventsFor(driver.id, 'trip:offer_closed').length, 1);
});

test('drivers set commute or go-anywhere, a destination, and seats to share up to their car\'s seats', async () => {
  const ctx = testApp();
  const driver = await makeUser(ctx, 'driver');
  const rider = await makeUser(ctx, 'rider');
  const go = (user, body) => request(ctx.app).post('/drivers/me/status').set('Authorization', user.auth).send(body);
  const online = { online: true, location: at(0) };

  await go(driver, online).expect(403); // waiting for approval
  ctx.drivers.drivers.get(driver.id).approved = true;
  await go(driver, { online: true }).expect(400);
  await go(driver, { ...online, mode: 'commute' }).expect(400); // needs a destination
  await go(driver, { ...online, mode: 'taxi' }).expect(400);
  await go(driver, { ...online, seatsOffered: 5 }).expect(400); // car has 4 seats

  await request(ctx.app).put('/drivers/me/vehicle').set('Authorization', driver.auth)
    .send({ vehicleMake: 'Toyota Corolla', vehiclePlate: 'GR 1234-24', seats: 6 }).expect(200);
  const res = await go(driver, { ...online, mode: 'commute', destination: at(10), destinationAddress: 'Tema', seatsOffered: 5 });
  assert.equal(res.status, 200);
  const me = await request(ctx.app).get('/drivers/me').set('Authorization', driver.auth).expect(200);
  assert.equal(me.body.driver.mode, 'commute');
  assert.equal(me.body.driver.seatsOffered, 5);
  assert.equal(me.body.driver.destinationAddress, 'Tema');
  assert.equal(me.body.driver.route.length, 2);

  await go(driver, { online: false }).expect(200);
  assert.equal(ctx.drivers.drivers.get(driver.id).online, false);
  await go(rider, online).expect(403);
});
