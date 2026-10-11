import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { testApp } from './helpers.js';

// Around Accra: drivers placed a few hundred metres to a few km from the pickup.
const PICKUP = { lat: 5.6037, lng: -0.187 };
const DROPOFF = { lat: 5.65, lng: -0.17 };
const near = (km) => ({ lat: PICKUP.lat + km / 111, lng: PICKUP.lng });

let phoneSeq = 241000000;
async function makeUser(ctx, role, name) {
  const user = await ctx.users.create({ phone: `+233${phoneSeq++}`, country: 'GH', role, name });
  return { ...user, auth: `Bearer ${ctx.tokens.sign(user)}` };
}

async function onlineDriver(ctx, km, name = 'Kofi') {
  const driver = await makeUser(ctx, 'driver', name);
  ctx.drivers.drivers.get(driver.id).approved = true;
  await request(ctx.app).post('/drivers/me/status').set('Authorization', driver.auth)
    .send({ online: true, location: near(km) }).expect(200);
  return driver;
}

const requestRide = (ctx, rider, body = { pickup: PICKUP, dropoff: DROPOFF }) =>
  request(ctx.app).post('/trips').set('Authorization', rider.auth).send(body);

test('a ride request is offered to the nearest drivers, closest first, in the rider\'s currency', async (t) => {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  const far = await onlineDriver(ctx, 4);
  const close = await onlineDriver(ctx, 0.5);
  const tooFar = await onlineDriver(ctx, 20);
  const rider = await makeUser(ctx, 'rider', 'Ama');

  const res = await requestRide(ctx, rider, { pickup: PICKUP, dropoff: DROPOFF, pickupAddress: 'Osu' });
  assert.equal(res.status, 201);
  assert.equal(res.body.trip.status, 'requested');
  assert.equal(res.body.trip.currency, 'GHS');
  assert.ok(res.body.trip.fareEstimate >= 1000);
  assert.equal(res.body.driversOffered, 2);

  const offer = ctx.notifier.eventsFor(close.id, 'trip:offer')[0];
  assert.equal(offer.payload.trip.id, res.body.trip.id);
  assert.equal(offer.payload.trip.pickupAddress, 'Osu');
  assert.equal(offer.payload.trip.riderId, undefined, 'offers do not reveal the rider');
  assert.equal(ctx.notifier.eventsFor(far.id, 'trip:offer').length, 1);
  assert.equal(ctx.notifier.eventsFor(tooFar.id, 'trip:offer').length, 0);
});

test('with no drivers nearby, no trip is created', async () => {
  const ctx = testApp();
  const rider = await makeUser(ctx, 'rider');
  const res = await requestRide(ctx, rider);
  assert.equal(res.status, 409);
  assert.equal(ctx.trips.trips.size, 0);
});

test('only riders can request rides, and only with valid points', async (t) => {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  const driver = await onlineDriver(ctx, 1);
  const rider = await makeUser(ctx, 'rider');
  await requestRide(ctx, driver).expect(403);
  await requestRide(ctx, rider, { pickup: PICKUP }).expect(400);
  await request(ctx.app).post('/trips').send({ pickup: PICKUP, dropoff: DROPOFF }).expect(401);
});

test('a rider can have only one active trip', async (t) => {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  await onlineDriver(ctx, 1);
  const rider = await makeUser(ctx, 'rider');
  await requestRide(ctx, rider).expect(201);
  const second = await requestRide(ctx, rider);
  assert.equal(second.status, 409);
});

test('the first driver to accept gets the ride; the others\' offers close', async (t) => {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  const first = await onlineDriver(ctx, 1, 'Kofi');
  const second = await onlineDriver(ctx, 2, 'Yaw');
  const rider = await makeUser(ctx, 'rider', 'Ama');
  const { body } = await requestRide(ctx, rider).expect(201);
  const tripId = body.trip.id;

  const accepted = await request(ctx.app).post(`/trips/${tripId}/accept`).set('Authorization', first.auth);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.trip.status, 'accepted');
  assert.equal(accepted.body.trip.driverId, first.id);
  assert.equal(accepted.body.rider.name, 'Ama');
  assert.equal(accepted.body.rider.phone, rider.phone);

  const late = await request(ctx.app).post(`/trips/${tripId}/accept`).set('Authorization', second.auth);
  assert.equal(late.status, 409);

  const toRider = ctx.notifier.eventsFor(rider.id, 'trip:accepted')[0];
  assert.equal(toRider.payload.driver.name, 'Kofi');
  assert.equal(ctx.notifier.eventsFor(second.id, 'trip:offer_closed').length, 1);
  assert.equal(ctx.notifier.eventsFor(first.id, 'trip:offer_closed').length, 0);
});

test('a driver who was not offered the trip cannot accept it', async (t) => {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  await onlineDriver(ctx, 1);
  const outsider = await makeUser(ctx, 'driver');
  const rider = await makeUser(ctx, 'rider');
  const { body } = await requestRide(ctx, rider).expect(201);
  await request(ctx.app).post(`/trips/${body.trip.id}/accept`).set('Authorization', outsider.auth).expect(404);
  await request(ctx.app).post(`/trips/${body.trip.id}/accept`).set('Authorization', rider.auth).expect(403);
});

test('a driver on a trip is not offered new rides', async (t) => {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  const driver = await onlineDriver(ctx, 1);
  const riderA = await makeUser(ctx, 'rider');
  const riderB = await makeUser(ctx, 'rider');
  const { body } = await requestRide(ctx, riderA).expect(201);
  await request(ctx.app).post(`/trips/${body.trip.id}/accept`).set('Authorization', driver.auth).expect(200);
  await requestRide(ctx, riderB).expect(409); // the only driver is busy
});

test('a rider can cancel a waiting request, closing the drivers\' offers', async (t) => {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  const driver = await onlineDriver(ctx, 1);
  const rider = await makeUser(ctx, 'rider');
  const { body } = await requestRide(ctx, rider).expect(201);

  const res = await request(ctx.app).post(`/trips/${body.trip.id}/cancel`).set('Authorization', rider.auth)
    .send({ reason: 'changed my mind' });
  assert.equal(res.status, 200);
  assert.equal(res.body.trip.status, 'cancelled');
  assert.equal(res.body.trip.cancelledBy, 'rider');
  assert.equal(ctx.notifier.eventsFor(driver.id, 'trip:offer_closed').length, 1);
  await request(ctx.app).post(`/trips/${body.trip.id}/accept`).set('Authorization', driver.auth).expect(409);
});

test('after accepting, either side can cancel and the other is told', async (t) => {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  const driver = await onlineDriver(ctx, 1);
  const rider = await makeUser(ctx, 'rider');
  const { body } = await requestRide(ctx, rider).expect(201);
  await request(ctx.app).post(`/trips/${body.trip.id}/accept`).set('Authorization', driver.auth).expect(200);

  const res = await request(ctx.app).post(`/trips/${body.trip.id}/cancel`).set('Authorization', driver.auth);
  assert.equal(res.body.trip.cancelledBy, 'driver');
  assert.equal(ctx.notifier.eventsFor(rider.id, 'trip:cancelled').length, 1);
  // Cancelled trips stay cancelled
  await request(ctx.app).post(`/trips/${body.trip.id}/cancel`).set('Authorization', rider.auth).expect(409);
});

test('only the trip\'s rider and driver can see or cancel it', async (t) => {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  await onlineDriver(ctx, 1);
  const rider = await makeUser(ctx, 'rider');
  const stranger = await makeUser(ctx, 'rider');
  const { body } = await requestRide(ctx, rider).expect(201);
  await request(ctx.app).get(`/trips/${body.trip.id}`).set('Authorization', rider.auth).expect(200);
  await request(ctx.app).get(`/trips/${body.trip.id}`).set('Authorization', stranger.auth).expect(404);
  await request(ctx.app).post(`/trips/${body.trip.id}/cancel`).set('Authorization', stranger.auth).expect(404);
  await request(ctx.app).get('/trips/not-a-uuid').set('Authorization', rider.auth).expect(404);
});

test('a request nobody accepts is cancelled automatically', async (t) => {
  const ctx = testApp({ dispatchOptions: { offerTimeoutMs: 20 } });
  t.after(() => ctx.dispatch.close());
  const driver = await onlineDriver(ctx, 1);
  const rider = await makeUser(ctx, 'rider');
  const { body } = await requestRide(ctx, rider).expect(201);

  await new Promise((r) => setTimeout(r, 60));
  const trip = ctx.trips.trips.get(body.trip.id);
  assert.equal(trip.status, 'cancelled');
  assert.equal(trip.cancelReason, 'no_driver_accepted');
  assert.equal(ctx.notifier.eventsFor(rider.id, 'trip:cancelled').length, 1);
  assert.equal(ctx.notifier.eventsFor(driver.id, 'trip:offer_closed').length, 1);
});

test('drivers must be approved to go online, and need a location', async () => {
  const ctx = testApp();
  const driver = await makeUser(ctx, 'driver');
  const rider = await makeUser(ctx, 'rider');
  const go = (user, body) => request(ctx.app).post('/drivers/me/status').set('Authorization', user.auth).send(body);

  await go(driver, { online: true, location: near(1) }).expect(403);
  ctx.drivers.drivers.get(driver.id).approved = true;
  await go(driver, { online: true }).expect(400);
  await go(driver, { online: true, location: near(1) }).expect(200);
  await go(driver, { online: false }).expect(200);
  assert.equal(ctx.drivers.drivers.get(driver.id).online, false);
  await go(rider, { online: true, location: near(1) }).expect(403);
});
