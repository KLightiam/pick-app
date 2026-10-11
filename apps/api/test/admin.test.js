import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { testApp } from './helpers.js';

// The admin queries run against PostgreSQL in db.test.js; this checks who can reach them and the input rules.

function fakeAdmin() {
  const calls = [];
  const record = (name, result) => async (args, more) => { calls.push({ name, args, more }); return result; };
  return {
    calls,
    overview: record('overview', { drivers: {}, riders: 0, trips: {}, money: [] }),
    listDrivers: record('listDrivers', []),
    setApproval: async (id, opts) => { calls.push({ name: 'setApproval', id, opts }); return id !== '00000000-0000-4000-8000-000000000000'; },
    listTrips: record('listTrips', []),
    listBalances: record('listBalances', []),
    listSettlements: record('listSettlements', []),
    recordSettlement: async (s) => { calls.push({ name: 'recordSettlement', s }); return { id: 's1', ...s }; },
    driverCountry: async (id) => (id === '00000000-0000-4000-8000-000000000000' ? null : 'DE'),
  };
}

async function setup() {
  const admin = fakeAdmin();
  const ctx = testApp({ admin });
  const make = async (role, phone) => {
    const user = await ctx.users.create({ phone, country: 'GH', role, name: role });
    return `Bearer ${ctx.tokens.sign(user)}`;
  };
  return { ctx, admin, adminAuth: await make('admin', '+233245550001'), riderAuth: await make('rider', '+233245550002') };
}

const DRIVER = '11111111-2222-4333-8444-555555555555';

test('only admins can use the admin API', async () => {
  const { ctx, riderAuth, adminAuth } = await setup();
  await request(ctx.app).get('/admin/overview').expect(401);
  await request(ctx.app).get('/admin/overview').set('Authorization', riderAuth).expect(403);
  await request(ctx.app).get('/admin/overview').set('Authorization', adminAuth).expect(200);
});

test('nobody can sign up as an admin', async () => {
  const { ctx } = await setup();
  const phone = '+233245550009';
  await request(ctx.app).post('/auth/code').send({ phone }).expect(204);
  await request(ctx.app).post('/auth/verify').send({ phone, code: ctx.sms.lastCode(phone), role: 'admin' }).expect(400);
});

test('filters are checked before they reach the database', async () => {
  const { ctx, adminAuth } = await setup();
  const get = (path) => request(ctx.app).get(path).set('Authorization', adminAuth);
  await get('/admin/overview?days=0').expect(400);
  await get('/admin/overview?country=FR').expect(400);
  await get('/admin/drivers?status=sleeping').expect(400);
  await get('/admin/trips?status=lost').expect(400);
  await get('/admin/trips?before=yesterday').expect(400);
  await get('/admin/settlements?driverId=nope').expect(400);
  await get('/admin/drivers?status=pending&country=DE&q=Kofi').expect(200);
});

test('approving and suspending drivers records who did it', async () => {
  const { ctx, admin, adminAuth } = await setup();
  const post = (path, body) => request(ctx.app).post(path).set('Authorization', adminAuth).send(body);
  await post(`/admin/drivers/${DRIVER}/approval`, { approved: 'yes' }).expect(400);
  await post('/admin/drivers/not-an-id/approval', { approved: true }).expect(404);
  await post('/admin/drivers/00000000-0000-4000-8000-000000000000/approval', { approved: true }).expect(404);
  await post(`/admin/drivers/${DRIVER}/approval`, { approved: false }).expect(200);
  const call = admin.calls.find((c) => c.name === 'setApproval' && c.id === DRIVER);
  assert.equal(call.opts.approved, false);
  assert.ok(call.opts.by);
});

test('settlements take the driver\'s currency and need a positive amount', async () => {
  const { ctx, admin, adminAuth } = await setup();
  const post = (body) => request(ctx.app).post('/admin/settlements').set('Authorization', adminAuth).send(body);
  await post({ driverId: DRIVER, direction: 'sideways', amount: 100 }).expect(400);
  await post({ driverId: DRIVER, direction: 'to_driver', amount: 0 }).expect(400);
  await post({ driverId: DRIVER, direction: 'to_driver', amount: 12.5 }).expect(400);
  await post({ driverId: '00000000-0000-4000-8000-000000000000', direction: 'to_driver', amount: 100 }).expect(404);
  const { body } = await post({ driverId: DRIVER, direction: 'to_driver', amount: 2411, reference: 'MoMo 123' }).expect(201);
  assert.equal(body.settlement.currency, 'EUR');
  assert.equal(admin.calls.at(-1).s.reference, 'MoMo 123');
});
