import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { testApp } from './helpers.js';

const KM = 1 / 110.6;
const at = (east) => ({ lat: 5.6, lng: -0.25 + east * KM });

let phoneSeq = 248000000;
async function makeUser(ctx, role, name) {
  const user = await ctx.users.create({ phone: `+233${phoneSeq++}`, country: 'GH', role, name });
  return { ...user, auth: `Bearer ${ctx.tokens.sign(user)}` };
}
const call = (ctx, user, method, path, body) => request(ctx.app)[method](path).set('Authorization', user.auth).send(body);

async function setup(t) {
  const ctx = testApp();
  t.after(() => ctx.dispatch.close());
  const driver = await makeUser(ctx, 'driver', 'Kofi');
  const rider = await makeUser(ctx, 'rider', 'Ama');
  ctx.drivers.drivers.get(driver.id).approved = true;
  Object.assign(ctx.drivers.drivers.get(driver.id), { vehicleMake: 'Toyota Corolla', vehiclePlate: 'GR 1234-24' });
  await call(ctx, driver, 'post', '/drivers/me/status', { online: true, location: at(0), mode: 'anywhere' }).expect(200);
  const book = async () => (await call(ctx, rider, 'post', '/trips', {
    driverId: driver.id, pickup: at(1), dropoff: at(6), pickupAddress: 'Osu', dropoffAddress: 'Airport',
  }).expect(201)).body.trip;
  const finish = async (id, steps = ['accept', 'arrived', 'start', 'complete']) => {
    for (const step of steps) await call(ctx, driver, 'post', `/trips/${id}/${step}`).expect(200);
  };
  return { ctx, driver, rider, book, finish };
}

test('rider and driver rate each other once the trip is over', async (t) => {
  const { ctx, driver, rider, book, finish } = await setup(t);
  const trip = await book();
  await call(ctx, rider, 'post', `/trips/${trip.id}/rating`, { stars: 5 }).expect(409); // not finished yet
  await finish(trip.id);

  await call(ctx, rider, 'post', `/trips/${trip.id}/rating`, { stars: 6 }).expect(400);
  await call(ctx, rider, 'post', `/trips/${trip.id}/rating`, { stars: 4.5 }).expect(400);
  await call(ctx, rider, 'post', `/trips/${trip.id}/rating`, { stars: 4, comment: 'x'.repeat(501) }).expect(400);
  const given = await call(ctx, rider, 'post', `/trips/${trip.id}/rating`, { stars: 4, comment: ' Smooth ride ' }).expect(201);
  assert.deepEqual([given.body.rating.stars, given.body.rating.comment], [4, 'Smooth ride']);
  await call(ctx, rider, 'post', `/trips/${trip.id}/rating`, { stars: 5 }).expect(409); // once only
  assert.equal((await call(ctx, rider, 'get', `/trips/${trip.id}/rating`).expect(200)).body.rating.stars, 4);
  assert.equal((await call(ctx, driver, 'get', `/trips/${trip.id}/rating`).expect(200)).body.rating, null);
  await call(ctx, driver, 'post', `/trips/${trip.id}/rating`, { stars: 5 }).expect(201);

  const stranger = await makeUser(ctx, 'rider', 'Esi');
  await call(ctx, stranger, 'post', `/trips/${trip.id}/rating`, { stars: 1 }).expect(404);
  assert.deepEqual(ctx.safetyRepo.ratings.map((r) => [r.fromUser, r.toUser]), [[rider.id, driver.id], [driver.id, rider.id]]);
});

test('riders see each driver\'s rating when choosing', async (t) => {
  const { ctx, driver, rider, book, finish } = await setup(t);
  const options = async () => (await call(ctx, rider, 'post', '/trips/options', { pickup: at(1), dropoff: at(6) }).expect(200)).body.options;
  assert.equal((await options())[0].driver.rating, null);
  for (const stars of [5, 4]) {
    const trip = await book();
    await finish(trip.id);
    await call(ctx, rider, 'post', `/trips/${trip.id}/rating`, { stars }).expect(201);
  }
  assert.deepEqual((await options())[0].driver.rating, { average: 4.5, count: 2 });
  assert.deepEqual((await call(ctx, driver, 'get', '/drivers/me').expect(200)).body.driver.rating, { average: 4.5, count: 2 });
  // The rider's trip shows who's driving, rating included; the driver's doesn't repeat themselves
  const last = await book();
  await call(ctx, driver, 'post', `/trips/${last.id}/accept`).expect(200);
  const seen = (await call(ctx, rider, 'get', `/trips/${last.id}`).expect(200)).body;
  assert.deepEqual([seen.driver.name, seen.driver.rating], ['Kofi', { average: 4.5, count: 2 }]);
  assert.equal((await call(ctx, driver, 'get', `/trips/${last.id}`).expect(200)).body.driver, undefined);
});

test('a shared trip link shows the trip until it ends', async (t) => {
  const { ctx, driver, rider, book, finish } = await setup(t);
  const trip = await book();
  await call(ctx, driver, 'post', `/trips/${trip.id}/share`).expect(403); // drivers can't share
  const { body } = await call(ctx, rider, 'post', `/trips/${trip.id}/share`).expect(201);
  assert.match(body.url, /^http:\/\/pick\.test\/share\/[\w-]{24}$/);
  const path = new URL(body.url).pathname;

  const page = await request(ctx.app).get(path).expect(200);
  assert.match(page.headers['content-type'], /html/);
  assert.equal(page.headers['referrer-policy'], 'no-referrer');
  const waiting = (await request(ctx.app).get(`${path}/status`).expect(200)).body;
  assert.deepEqual(waiting, { status: 'requested', ended: false, pickupAddress: 'Osu', dropoffAddress: 'Airport', driver: null });

  await finish(trip.id, ['accept']);
  const coming = (await request(ctx.app).get(`${path}/status`).expect(200)).body;
  assert.deepEqual(coming.driver, { name: 'Kofi', vehicleMake: 'Toyota Corolla', vehiclePlate: 'GR 1234-24', location: at(0) });

  await finish(trip.id, ['arrived', 'start', 'complete']);
  assert.deepEqual((await request(ctx.app).get(`${path}/status`).expect(200)).body, { status: 'completed', ended: true });
  await call(ctx, rider, 'post', `/trips/${trip.id}/share`).expect(409);
  await request(ctx.app).get('/share/not-a-real-link/status').expect(404);
});

test('problems reported on a trip reach admins, who resolve them', async (t) => {
  const { ctx, driver, rider, book, finish } = await setup(t);
  const admin = await makeUser(ctx, 'admin', 'Kingsley');
  const trip = await book();
  await finish(trip.id);

  await call(ctx, rider, 'post', `/trips/${trip.id}/reports`, { category: 'gossip' }).expect(400);
  const { body } = await call(ctx, rider, 'post', `/trips/${trip.id}/reports`, {
    category: 'driving', details: 'Kept checking his phone',
  }).expect(201);
  assert.deepEqual([body.report.category, body.report.aboutUserId, body.report.status], ['driving', driver.id, 'open']);
  await call(ctx, driver, 'post', `/trips/${trip.id}/reports`, { category: 'lost_item' }).expect(201);
  await call(ctx, await makeUser(ctx, 'rider', 'Esi'), 'post', `/trips/${trip.id}/reports`, { category: 'other' }).expect(404);

  await call(ctx, rider, 'get', '/admin/reports').expect(403);
  assert.equal((await call(ctx, admin, 'get', '/admin/reports?status=open').expect(200)).body.reports.length, 2);
  await call(ctx, admin, 'get', '/admin/reports?status=lost').expect(400);
  const resolved = await call(ctx, admin, 'post', `/admin/reports/${body.report.id}/resolve`, { note: 'Spoke to the driver' }).expect(200);
  assert.deepEqual([resolved.body.report.status, resolved.body.report.resolutionNote], ['resolved', 'Spoke to the driver']);
  await call(ctx, admin, 'post', `/admin/reports/${body.report.id}/resolve`, {}).expect(409);
  await call(ctx, admin, 'post', '/admin/reports/00000000-0000-4000-8000-000000000000/resolve', {}).expect(404);
  assert.equal((await call(ctx, admin, 'get', '/admin/reports?status=open').expect(200)).body.reports.length, 1);
});
