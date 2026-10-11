import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { testApp } from './helpers.js';

const GH_PHONE = '+233241234567';
const DE_PHONE = '+4915123456789';

async function signIn(ctx, phone, extra = {}) {
  await request(ctx.app).post('/auth/code').send({ phone }).expect(204);
  const sentTo = ctx.sms.sent.at(-1).to;
  return request(ctx.app).post('/auth/verify').send({ phone, code: ctx.sms.lastCode(sentTo), ...extra });
}

test('a new rider in Ghana signs up with a texted code', async () => {
  const ctx = testApp();
  const res = await signIn(ctx, '+233 24 123 4567', { role: 'rider', name: 'Ama' });
  assert.equal(res.status, 200);
  assert.equal(res.body.isNew, true);
  assert.equal(res.body.user.phone, GH_PHONE);
  assert.equal(res.body.user.country, 'GH');
  assert.equal(res.body.user.role, 'rider');

  const me = await request(ctx.app).get('/auth/me').set('Authorization', `Bearer ${res.body.token}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.name, 'Ama');
});

test('a new driver in Germany signs up, then signs in again without a role', async () => {
  const ctx = testApp();
  const first = await signIn(ctx, DE_PHONE, { role: 'driver' });
  assert.equal(first.body.user.country, 'DE');
  assert.equal(first.body.user.role, 'driver');

  const again = await signIn(ctx, DE_PHONE);
  assert.equal(again.status, 200);
  assert.equal(again.body.isNew, false);
  assert.equal(again.body.user.id, first.body.user.id);
});

test('numbers outside Ghana and Germany are rejected', async () => {
  const ctx = testApp();
  const res = await request(ctx.app).post('/auth/code').send({ phone: '+14155552671' });
  assert.equal(res.status, 400);
  assert.equal(ctx.sms.sent.length, 0);
});

test('new accounts must choose rider or driver', async () => {
  const ctx = testApp();
  const res = await signIn(ctx, GH_PHONE, { role: 'admin' });
  assert.equal(res.status, 400);
  assert.equal(ctx.users.users.length, 0);
});

test('a wrong code is refused, and the code locks after 5 wrong tries', async () => {
  const ctx = testApp();
  await request(ctx.app).post('/auth/code').send({ phone: GH_PHONE }).expect(204);
  const code = ctx.sms.lastCode(GH_PHONE);
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) {
    await request(ctx.app).post('/auth/verify').send({ phone: GH_PHONE, code: wrong, role: 'rider' }).expect(401);
  }
  await request(ctx.app).post('/auth/verify').send({ phone: GH_PHONE, code, role: 'rider' }).expect(401);
});

test('a code works only once', async () => {
  const ctx = testApp();
  await request(ctx.app).post('/auth/code').send({ phone: GH_PHONE }).expect(204);
  const code = ctx.sms.lastCode(GH_PHONE);
  await request(ctx.app).post('/auth/verify').send({ phone: GH_PHONE, code, role: 'rider' }).expect(200);
  await request(ctx.app).post('/auth/verify').send({ phone: GH_PHONE, code }).expect(401);
});

test('codes expire after 5 minutes', async () => {
  let clock = new Date('2026-10-11T12:00:00Z');
  const ctx = testApp({ now: () => clock });
  await request(ctx.app).post('/auth/code').send({ phone: GH_PHONE }).expect(204);
  clock = new Date(clock.getTime() + 5 * 60 * 1000 + 1);
  await request(ctx.app).post('/auth/verify')
    .send({ phone: GH_PHONE, code: ctx.sms.lastCode(GH_PHONE), role: 'rider' }).expect(401);
});

test('at most 5 codes per number per hour', async () => {
  const ctx = testApp();
  for (let i = 0; i < 5; i++) await request(ctx.app).post('/auth/code').send({ phone: GH_PHONE }).expect(204);
  await request(ctx.app).post('/auth/code').send({ phone: GH_PHONE }).expect(429);
});

test('/auth/me needs a valid token', async () => {
  const ctx = testApp();
  await request(ctx.app).get('/auth/me').expect(401);
  await request(ctx.app).get('/auth/me').set('Authorization', 'Bearer nonsense').expect(401);
});
