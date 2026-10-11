import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { testApp } from './helpers.js';

const KM = 1 / 110.6;
const at = (east) => ({ lat: 5.6, lng: -0.25 + east * KM });
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);

let phoneSeq = 247000000;
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
  Object.assign(ctx.drivers.drivers.get(driver.id), { approved: true, vehicleMake: 'Toyota Corolla', vehiclePlate: 'GR 1234-24' });
  await call(ctx, driver, 'post', '/drivers/me/status', { online: true, location: at(0), mode: 'anywhere' }).expect(200);
  const book = async () => (await call(ctx, rider, 'post', '/trips', { driverId: driver.id, pickup: at(1), dropoff: at(6) })
    .expect(201)).body.trip;
  return { ctx, driver, rider, book };
}

test('a rider deletes their account once their ride is over, and the number can sign up again', async (t) => {
  const { ctx, rider, book } = await setup(t);
  const trip = await book();
  const refused = await call(ctx, rider, 'delete', '/auth/me').expect(409);
  assert.equal(refused.body.error, 'Finish or cancel your current ride first');
  await call(ctx, rider, 'post', `/trips/${trip.id}/cancel`).expect(200);

  await call(ctx, rider, 'delete', '/auth/me').expect(204);
  await call(ctx, rider, 'get', '/auth/me').expect(401);
  const gone = ctx.users.users.find((u) => u.id === rider.id);
  assert.deepEqual([gone.phone, gone.name, Boolean(gone.deletedAt)], [`deleted:${rider.id}`, null, true]);
  await call(ctx, rider, 'delete', '/auth/me').expect(404);

  await request(ctx.app).post('/auth/code').send({ phone: rider.phone }).expect(204);
  const again = await request(ctx.app).post('/auth/verify')
    .send({ phone: rider.phone, code: ctx.sms.lastCode(rider.phone), role: 'rider', name: 'Ama' }).expect(200);
  assert.equal(again.body.isNew, true);
  assert.notEqual(again.body.user.id, rider.id);
});

test('a driver who owes commission settles first; deleting removes their car, documents and payout details', async (t) => {
  const { ctx, driver, book } = await setup(t);
  await call(ctx, driver, 'put', '/drivers/me/documents/licence').set('Content-Type', 'image/jpeg').send(jpeg).expect(201);
  await call(ctx, driver, 'put', '/drivers/me/payout-account').send({ name: 'Kofi Mensah', number: '0241234567', network: 'MTN' })
    .expect(200);
  assert.equal(ctx.storage.files.size, 1);

  const trip = await book(); // paid in cash: Kofi owes Pick its commission
  for (const step of ['accept', 'arrived', 'start', 'complete']) await call(ctx, driver, 'post', `/trips/${trip.id}/${step}`).expect(200);
  const owes = await call(ctx, driver, 'delete', '/auth/me').expect(409);
  assert.match(owes.body.error, /^You owe Pick GH₵\d+\.\d\d in commission/);

  const { balance } = await ctx.paymentsRepo.balanceFor(driver.id);
  ctx.paymentsRepo.settlements.push({ driverId: driver.id, direction: 'from_driver', amount: -balance, currency: 'GHS' });
  await call(ctx, driver, 'delete', '/auth/me').expect(204);
  assert.equal(ctx.storage.files.size, 0);
  assert.equal(ctx.documentsRepo.documents.size, 0);
  assert.equal(await ctx.payoutsRepo.findAccount(driver.id), null);
  const row = ctx.drivers.drivers.get(driver.id);
  assert.deepEqual([row.online, row.approved, row.vehiclePlate, row.location], [false, false, null, null]);
  // Their past trip is kept for Pick's records
  assert.equal((await ctx.trips.findById(trip.id)).status, 'completed');
});

test('admins can\'t delete themselves from the app', async (t) => {
  const { ctx } = await setup(t);
  const admin = await makeUser(ctx, 'admin', 'Kingsley');
  await call(ctx, admin, 'delete', '/auth/me').expect(403);
});
