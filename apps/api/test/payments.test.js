import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { testApp } from './helpers.js';
import { paystackProvider, stripeProvider, WebhookSignatureError } from '../src/payments/providers.js';

const KM = 1 / 110.6;
const at = (east, north = 0) => ({ lat: 5.6 + north * KM, lng: -0.25 + east * KM });

let phoneSeq = 244000000;
async function makeUser(ctx, role, name) {
  const user = await ctx.users.create({ phone: `+233${phoneSeq++}`, country: 'GH', role, name });
  return { ...user, auth: `Bearer ${ctx.tokens.sign(user)}` };
}

const post = (ctx, user, path, body) => request(ctx.app).post(path).set('Authorization', user.auth).send(body);
const get = (ctx, user, path) => request(ctx.app).get(path).set('Authorization', user.auth);

async function setup(t, options) {
  const ctx = testApp(options);
  t.after(() => ctx.dispatch.close());
  const driver = await makeUser(ctx, 'driver', 'Kofi');
  ctx.drivers.drivers.get(driver.id).approved = true;
  await post(ctx, driver, '/drivers/me/status', { online: true, location: at(0), mode: 'anywhere' }).expect(200);
  const rider = await makeUser(ctx, 'rider', 'Ama');
  return { ctx, driver, rider };
}

/** Books with the given payment method and drives the trip to the drop-off. */
async function finishedRide({ ctx, driver, rider }, paymentMethod) {
  const { body } = await post(ctx, rider, '/trips', {
    driverId: driver.id, pickup: at(1), dropoff: at(6), paymentMethod,
  }).expect(201);
  const id = body.trip.id;
  for (const step of ['accept', 'arrived', 'start']) await post(ctx, driver, `/trips/${id}/${step}`).expect(200);
  const done = await post(ctx, driver, `/trips/${id}/complete`).expect(200);
  return { id, done: done.body };
}

test('a cash ride records the fare and the commission the driver owes', async (t) => {
  const s = await setup(t);
  const { id, done } = await finishedRide(s, 'cash');
  const fare = done.trip.fareFinal;

  assert.equal(done.trip.paymentMethod, 'cash');
  assert.equal(done.payment.method, 'cash');
  assert.equal(done.payment.status, 'cash');
  assert.equal(done.payment.amount, fare);
  assert.equal(done.payment.commission, Math.round(fare * 0.15));
  assert.equal(s.ctx.notifier.eventsFor(s.rider.id, 'trip:completed')[0].payload.payment.status, 'cash');

  await post(s.ctx, s.rider, `/trips/${id}/pay`).expect(409); // nothing to pay in the app
  const { body: earnings } = await get(s.ctx, s.driver, '/drivers/me/earnings').expect(200);
  assert.equal(earnings.balance.cashCollected, fare);
  assert.equal(earnings.balance.commissionOnCash, done.payment.commission);
  assert.equal(earnings.balance.balance, -done.payment.commission);
  assert.equal(earnings.rides.length, 1);
});

test('an app ride is paid after drop-off through the checkout page, and both sides hear about it', async (t) => {
  const s = await setup(t);
  const { id, done } = await finishedRide(s, 'app');
  assert.equal(done.payment.status, 'pending');
  assert.equal(done.payment.provider, 'test');

  // Unpaid: the rider can't book again until they pay.
  const { body: unpaid } = await get(s.ctx, s.rider, '/payments/unpaid').expect(200);
  assert.equal(unpaid.payment.tripId, id);
  assert.equal(unpaid.trip.id, id);
  const blocked = await post(s.ctx, s.rider, '/trips', { driverId: s.driver.id, pickup: at(1), dropoff: at(6) });
  assert.equal(blocked.status, 402);

  // Only the rider pays, and the driver can't start a checkout.
  await post(s.ctx, s.driver, `/trips/${id}/pay`).expect(403);
  const { body: checkout } = await post(s.ctx, s.rider, `/trips/${id}/pay`).expect(200);
  assert.match(checkout.checkoutUrl, /^http:\/\/pick\.test\/payments\/test-checkout\/test_/);
  const ref = checkout.checkoutUrl.split('/').pop();

  const page = await request(s.ctx.app).get(`/payments/test-checkout/${ref}`).expect(200);
  assert.match(page.text, /Pay GHS/);
  await request(s.ctx.app).post(`/payments/test-checkout/${ref}`).expect(303);

  const { body: after } = await get(s.ctx, s.rider, `/trips/${id}/payment`).expect(200);
  assert.equal(after.payment.status, 'paid');
  assert.equal(s.ctx.notifier.eventsFor(s.rider.id, 'payment:paid').length, 1);
  assert.equal(s.ctx.notifier.eventsFor(s.driver.id, 'payment:paid').length, 1);
  await post(s.ctx, s.rider, `/trips/${id}/pay`).expect(409); // already paid

  const { body: earnings } = await get(s.ctx, s.driver, '/drivers/me/earnings').expect(200);
  assert.equal(earnings.balance.owedToDriver, done.payment.amount - done.payment.commission);
  assert.equal((await get(s.ctx, s.rider, '/payments/unpaid').expect(200)).body.payment, null);
  await post(s.ctx, s.rider, '/trips', { driverId: s.driver.id, pickup: at(1), dropoff: at(6) }).expect(201);
});

test('coming back to the app checks with the provider if the webhook has not arrived', async (t) => {
  let status = { paid: false };
  const provider = {
    name: 'paystack',
    createCheckout: async () => ({ ref: 'ref_1', url: 'https://checkout.paystack.test/abc' }),
    checkStatus: async () => status,
    parseWebhook: () => null,
  };
  const s = await setup(t, { providers: { paystack: provider } });
  const { id, done } = await finishedRide(s, 'app');
  assert.equal(done.payment.provider, 'paystack');
  await post(s.ctx, s.rider, `/trips/${id}/pay`).expect(200);

  assert.equal((await get(s.ctx, s.rider, `/trips/${id}/payment`)).body.payment.status, 'pending');
  status = { paid: true, paymentId: done.payment.id, amount: done.payment.amount + 1, currency: 'GHS' };
  assert.equal((await get(s.ctx, s.rider, `/trips/${id}/payment`)).body.payment.status, 'pending'); // wrong amount
  status = { ...status, amount: done.payment.amount };
  assert.equal((await get(s.ctx, s.rider, `/trips/${id}/payment`)).body.payment.status, 'paid');
});

test('payment details stay between the trip\'s rider and driver', async (t) => {
  const s = await setup(t);
  const { id } = await finishedRide(s, 'app');
  const stranger = await makeUser(s.ctx, 'rider');
  await get(s.ctx, stranger, `/trips/${id}/payment`).expect(404);
  await post(s.ctx, stranger, `/trips/${id}/pay`).expect(404);
  assert.equal((await get(s.ctx, s.driver, `/trips/${id}/payment`)).body.payment.status, 'pending');
});

test('payment method must be cash or app, and webhooks with a bad signature are refused', async (t) => {
  const s = await setup(t, { providers: { paystack: paystackProvider({ secretKey: 'sk_test_1' }) } });
  const bad = await post(s.ctx, s.rider, '/trips', {
    driverId: s.driver.id, pickup: at(1), dropoff: at(6), paymentMethod: 'cheque',
  });
  assert.equal(bad.status, 400);
  await request(s.ctx.app).post('/payments/webhooks/paystack').send({ event: 'charge.success' }).expect(400);
  await request(s.ctx.app).post('/payments/webhooks/unknown').send({}).expect(200);
});

// Providers, against the request and response formats in Paystack's and Stripe's docs.

function recorder(reply) {
  const calls = [];
  return {
    calls,
    fetchFn: async (url, init = {}) => {
      calls.push({ url, ...init });
      return { ok: true, status: 200, json: async () => reply };
    },
  };
}

const payment = { id: '11111111-2222-4333-8444-555555555555', tripId: 'trip-1', amount: 2837, currency: 'GHS' };

test('Paystack: starts a card or mobile money checkout and verifies webhooks', async () => {
  const { calls, fetchFn } = recorder({
    status: true, data: { authorization_url: 'https://checkout.paystack.com/x', reference: 'pick_ref' },
  });
  const paystack = paystackProvider({ secretKey: 'sk_test_1', fetchFn });
  const result = await paystack.createCheckout({ payment, email: 'rider-1@riders.pick.invalid', returnUrl: 'http://pick.test/payments/return' });
  assert.deepEqual(result, { ref: 'pick_ref', url: 'https://checkout.paystack.com/x' });
  assert.equal(calls[0].url, 'https://api.paystack.co/transaction/initialize');
  assert.equal(calls[0].headers.Authorization, 'Bearer sk_test_1');
  const sent = JSON.parse(calls[0].body);
  assert.equal(sent.amount, 2837); // pesewas
  assert.equal(sent.currency, 'GHS');
  assert.deepEqual(sent.channels, ['card', 'mobile_money']);
  assert.equal(sent.metadata.paymentId, payment.id);

  const body = Buffer.from(JSON.stringify({
    event: 'charge.success', data: { amount: 2837, currency: 'GHS', metadata: { paymentId: payment.id } },
  }));
  const signature = createHmac('sha512', 'sk_test_1').update(body).digest('hex');
  assert.deepEqual(paystack.parseWebhook(body, { 'x-paystack-signature': signature }), {
    kind: 'payment', paymentId: payment.id, amount: 2837, currency: 'GHS',
  });
  assert.throws(() => paystack.parseWebhook(body, { 'x-paystack-signature': 'ab'.repeat(64) }), WebhookSignatureError);
  assert.throws(() => paystack.parseWebhook(body, {}), WebhookSignatureError);
  const other = Buffer.from(JSON.stringify({ event: 'customeridentification.success', data: {} }));
  assert.equal(paystack.parseWebhook(other, {
    'x-paystack-signature': createHmac('sha512', 'sk_test_1').update(other).digest('hex'),
  }), null);
});

test('Stripe: starts a Checkout session and verifies signed webhooks', async () => {
  const { calls, fetchFn } = recorder({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  const now = Date.parse('2026-10-11T10:00:00Z');
  const stripe = stripeProvider({ secretKey: 'sk_test_2', webhookSecret: 'whsec_1', fetchFn, now: () => now });
  const eur = { ...payment, currency: 'EUR', amount: 1290 };
  assert.deepEqual(await stripe.createCheckout({ payment: eur, returnUrl: 'http://pick.test/payments/return' }), {
    ref: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1',
  });
  assert.equal(calls[0].url, 'https://api.stripe.com/v1/checkout/sessions');
  const form = new URLSearchParams(calls[0].body.toString());
  assert.equal(form.get('mode'), 'payment');
  assert.equal(form.get('line_items[0][price_data][currency]'), 'eur');
  assert.equal(form.get('line_items[0][price_data][unit_amount]'), '1290');
  assert.equal(form.get('client_reference_id'), payment.id);

  const body = Buffer.from(JSON.stringify({
    type: 'checkout.session.completed',
    data: { object: { client_reference_id: payment.id, payment_status: 'paid', amount_total: 1290, currency: 'eur' } },
  }));
  const sign = (t, raw = body) => `t=${t},v1=${createHmac('sha256', 'whsec_1').update(`${t}.${raw}`).digest('hex')}`;
  const t = Math.floor(now / 1000);
  assert.deepEqual(stripe.parseWebhook(body, { 'stripe-signature': sign(t) }), {
    kind: 'payment', paid: true, paymentId: payment.id, amount: 1290, currency: 'eur',
  });
  assert.throws(() => stripe.parseWebhook(body, { 'stripe-signature': sign(t - 600) }), WebhookSignatureError); // too old
  assert.throws(() => stripe.parseWebhook(body, { 'stripe-signature': `t=${t},v1=${'0'.repeat(64)}` }), WebhookSignatureError);
});
