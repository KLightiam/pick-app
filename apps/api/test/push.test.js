import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import request from 'supertest';
import { testApp } from './helpers.js';
import { expoPushSender, isExpoPushToken } from '../src/push/expo.js';
import { pushMessageFor } from '../src/push/messages.js';

const KM = 1 / 110.6;
const at = (east) => ({ lat: 5.6, lng: -0.25 + east * KM });

let phoneSeq = 247000000;
async function makeUser(ctx, role) {
  const user = await ctx.users.create({ phone: `+233${phoneSeq++}`, country: 'GH', role, name: role === 'driver' ? 'Kofi' : 'Ama' });
  return { ...user, auth: `Bearer ${ctx.tokens.sign(user)}` };
}

const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const send = (ctx, user, method, path, body) => request(ctx.app)[method](path).set('Authorization', user.auth).send(body);

test('phones register for push notifications, and sign-out forgets them', async () => {
  const ctx = testApp();
  const ama = await makeUser(ctx, 'rider');
  await request(ctx.app).put('/auth/push-token').send({ token: TOKEN, platform: 'ios' }).expect(401);
  await send(ctx, ama, 'put', '/auth/push-token', { token: 'not-a-token', platform: 'ios' }).expect(400);
  await send(ctx, ama, 'put', '/auth/push-token', { token: TOKEN, platform: 'web' }).expect(400);
  await send(ctx, ama, 'put', '/auth/push-token', { token: TOKEN, platform: 'ios' }).expect(204);
  assert.deepEqual(await ctx.pushTokens.listForUser(ama.id), [TOKEN]);

  // Someone else signs in on the same phone: the token moves to them
  const esi = await makeUser(ctx, 'rider');
  await send(ctx, esi, 'put', '/auth/push-token', { token: TOKEN, platform: 'ios' }).expect(204);
  assert.deepEqual(await ctx.pushTokens.listForUser(ama.id), []);
  await send(ctx, ama, 'delete', '/auth/push-token', { token: TOKEN }).expect(204); // not Ama's any more
  assert.deepEqual(await ctx.pushTokens.listForUser(esi.id), [TOKEN]);
  await send(ctx, esi, 'delete', '/auth/push-token', { token: TOKEN }).expect(204);
  assert.deepEqual(await ctx.pushTokens.listForUser(esi.id), []);
});

test('a ride request reaches the driver\'s phone, and trip updates reach the rider\'s', async (t) => {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  const driver = await makeUser(ctx, 'driver');
  const rider = await makeUser(ctx, 'rider');
  const driverPhone = 'ExponentPushToken[driver-phone]';
  const riderPhone = 'ExponentPushToken[rider-phone]';
  await send(ctx, driver, 'put', '/auth/push-token', { token: driverPhone, platform: 'android' }).expect(204);
  await send(ctx, rider, 'put', '/auth/push-token', { token: riderPhone, platform: 'ios' }).expect(204);
  ctx.drivers.drivers.get(driver.id).approved = true;
  await send(ctx, driver, 'post', '/drivers/me/status', { online: true, location: at(0), mode: 'anywhere' }).expect(200);

  const { body } = await send(ctx, rider, 'post', '/trips', {
    driverId: driver.id, pickup: at(1), dropoff: at(6), pickupAddress: 'Osu Oxford Street',
  }).expect(201);
  const id = body.trip.id;
  await tick();
  const offer = ctx.pushSender.sent.find((m) => m.to === driverPhone);
  assert.equal(offer.title, 'New ride request');
  assert.match(offer.body, /^Pickup: Osu Oxford Street · GH₵\d+\.\d\d\. Open Pick to accept\.$/);
  assert.deepEqual(offer.data, { event: 'trip:offer', tripId: id });
  assert.equal(offer.channelId, 'ride-requests');
  assert.equal(offer.ttl, 60);

  for (const step of ['accept', 'arrived', 'start', 'complete']) {
    await send(ctx, driver, 'post', `/trips/${id}/${step}`).expect(200);
  }
  await tick();
  const toRider = ctx.pushSender.sent.filter((m) => m.to === riderPhone).map((m) => m.title);
  assert.deepEqual(toRider, ['Your driver is on the way', 'Your driver has arrived', 'Trip complete']); // nothing for "start"
  // The live updates still went out as before
  assert.deepEqual(ctx.notifier.eventsFor(rider.id).map((e) => e.event),
    ['trip:accepted', 'trip:status', 'trip:status', 'trip:completed']);
});

test('tokens of uninstalled apps are forgotten', async () => {
  const ctx = testApp();
  const driver = await makeUser(ctx, 'driver');
  await send(ctx, driver, 'put', '/auth/push-token', { token: TOKEN, platform: 'android' }).expect(204);
  ctx.pushSender.uninstalled.add(TOKEN);
  ctx.notifier.toUser(driver.id, 'payout:updated', { payout: { status: 'paid', amount: 5100, currency: 'GHS' } });
  await tick();
  await tick();
  assert.equal(ctx.pushSender.sent.length, 1);
  assert.deepEqual(await ctx.pushTokens.listForUser(driver.id), []);
});

test('push failures never break the live update', async () => {
  const ctx = testApp();
  const driver = await makeUser(ctx, 'driver');
  await send(ctx, driver, 'put', '/auth/push-token', { token: TOKEN, platform: 'android' }).expect(204);
  ctx.pushSender.send = async () => { throw new Error('Expo is down'); };
  ctx.notifier.toUser(driver.id, 'payout:updated', { payout: { status: 'paid', amount: 5100, currency: 'GHS' } });
  await tick();
  assert.equal(ctx.notifier.eventsFor(driver.id, 'payout:updated').length, 1);
});

test('what each event says', () => {
  const trip = { id: 't1', currency: 'EUR', fareFinal: 1290, paymentMethod: 'app', status: 'arrived', cancelledBy: 'driver' };
  assert.equal(pushMessageFor('trip:completed', { trip }).body, 'Your fare is €12.90. Open Pick to pay.');
  assert.equal(pushMessageFor('trip:completed', { trip: { ...trip, paymentMethod: 'cash' } }).body,
    'Your fare is €12.90. Please pay the driver in cash.');
  assert.equal(pushMessageFor('trip:status', { trip: { ...trip, status: 'in_progress' } }), null);
  assert.match(pushMessageFor('trip:cancelled', { trip }).body, /choose another/);
  assert.equal(pushMessageFor('trip:accepted', { trip, driver: { name: 'Kofi', vehiclePlate: 'GR 1234-24' } }).body,
    'Kofi accepted your ride (GR 1234-24).');
  const payment = { riderId: 'r1', driverId: 'd1', amount: 2837, currency: 'GHS' };
  assert.equal(pushMessageFor('payment:paid', { payment }, 'r1'), null); // the rider just paid, they know
  assert.equal(pushMessageFor('payment:paid', { payment }, 'd1').body, 'GH₵28.37 paid in the app.');
  assert.equal(pushMessageFor('payout:updated', { payout: { status: 'pending', amount: 1, currency: 'GHS' } }), null);
  assert.equal(pushMessageFor('driver:location', {}), null);
});

test('Expo: sends a batch and reports uninstalled apps', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, ...init });
    return {
      ok: true, status: 200,
      json: async () => ({ data: [{ status: 'ok', id: '1' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] }),
    };
  };
  const sender = expoPushSender({ accessToken: 'expo-token', fetchFn });
  const results = await sender.send([{ to: 'ExponentPushToken[a]', title: 'Hi' }, { to: 'ExponentPushToken[b]', title: 'Hi' }]);
  assert.deepEqual(results, [
    { token: 'ExponentPushToken[a]', ok: true, unregistered: false },
    { token: 'ExponentPushToken[b]', ok: false, unregistered: true },
  ]);
  assert.equal(calls[0].url, 'https://exp.host/--/api/v2/push/send');
  assert.equal(calls[0].headers.Authorization, 'Bearer expo-token');
  assert.equal(JSON.parse(calls[0].body).length, 2);
  assert.deepEqual(await sender.send([]), []);
  assert.equal(calls.length, 1);

  assert.ok(isExpoPushToken('ExponentPushToken[abc]'));
  assert.ok(isExpoPushToken('ExpoPushToken[abc]'));
  assert.ok(!isExpoPushToken('ExponentPushToken[]'));
  assert.ok(!isExpoPushToken(`ExponentPushToken[${'a'.repeat(300)}]`));
});

test('a driver opening the app from a ride request push sees the request', async (t) => {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  const driver = await makeUser(ctx, 'driver');
  const rider = await makeUser(ctx, 'rider');
  ctx.drivers.drivers.get(driver.id).approved = true;
  await send(ctx, driver, 'post', '/drivers/me/status', { online: true, location: at(0), mode: 'anywhere' }).expect(200);
  assert.deepEqual((await send(ctx, driver, 'get', '/trips/offers').expect(200)).body.offers, []);

  const { body } = await send(ctx, rider, 'post', '/trips', { driverId: driver.id, pickup: at(1), dropoff: at(6) }).expect(201);
  const { offers } = (await send(ctx, driver, 'get', '/trips/offers').expect(200)).body;
  assert.equal(offers.length, 1);
  assert.equal(offers[0].trip.id, body.trip.id);
  assert.equal(offers[0].trip.riderId, undefined); // the same view as the live offer
  assert.equal(Date.parse(offers[0].expiresAt) - Date.parse(body.trip.requestedAt), 60_000);
  await send(ctx, rider, 'get', '/trips/offers').expect(403);

  await send(ctx, driver, 'post', `/trips/${body.trip.id}/accept`).expect(200);
  assert.deepEqual((await send(ctx, driver, 'get', '/trips/offers').expect(200)).body.offers, []);
});
