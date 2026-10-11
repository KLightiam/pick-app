import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { testApp } from './helpers.js';
import { paystackProvider, stripeProvider } from '../src/payments/providers.js';

let phoneSeq = 246000000;
async function makeUser(ctx, role, country = 'GH') {
  const phone = country === 'GH' ? `+233${phoneSeq++}` : `+49151${phoneSeq++}`;
  const user = await ctx.users.create({ phone, country, role, name: role });
  return { ...user, auth: `Bearer ${ctx.tokens.sign(user)}` };
}

/** A test app whose payouts clock only moves when told: ctx.days(7) */
function setup(options = {}) {
  let now = new Date('2026-10-12T07:00:00Z');
  const ctx = testApp({ payoutsNow: () => new Date(now), admin: { driverCountry: async () => 'GH' }, ...options });
  ctx.days = (d) => { now = new Date(now.getTime() + d * 24 * 60 * 60 * 1000); };
  ctx.minutes = (m) => { now = new Date(now.getTime() + m * 60 * 1000); };
  return ctx;
}

const put = (ctx, user, path, body) => request(ctx.app).put(path).set('Authorization', user.auth).send(body);
const post = (ctx, user, path, body) => request(ctx.app).post(path).set('Authorization', user.auth).send(body);
const get = (ctx, user, path) => request(ctx.app).get(path).set('Authorization', user.auth);

/** A paid app ride: Pick holds the fare and owes the driver all but its commission. */
const appRide = (ctx, driver, amount, currency = 'GHS') => ctx.paymentsRepo.create({
  tripId: randomUUID(), riderId: randomUUID(), driverId: driver.id, method: 'app', provider: 'test',
  amount, commission: Math.round(amount * 0.15), currency, status: 'paid',
});

async function driverWithMomo(ctx, country = 'GH') {
  const driver = await makeUser(ctx, 'driver', country);
  ctx.drivers.drivers.get(driver.id).approved = true;
  await put(ctx, driver, '/drivers/me/payout-account', { name: 'Kofi Mensah', number: '024 123 4567', network: 'MTN' }).expect(200);
  return driver;
}

const balance = async (ctx, driver) => (await ctx.paymentsRepo.balanceFor(driver.id)).balance;

test('a Ghanaian driver adds their mobile money account', async () => {
  const ctx = setup();
  const driver = await makeUser(ctx, 'driver');
  const path = '/drivers/me/payout-account';

  const before = await get(ctx, driver, '/drivers/me/payouts').expect(200);
  assert.equal(before.body.account, null);
  assert.deepEqual(before.body.schedule, { method: 'mobile_money', minimum: 2000, everyDays: 7, currency: 'GHS' });
  assert.deepEqual(before.body.networks.map((n) => n.code), ['MTN', 'VOD', 'ATL']);

  await put(ctx, driver, path, { name: 'Kofi', number: '0241234567', network: 'XYZ' }).expect(400);
  await put(ctx, driver, path, { name: 'Kofi', number: '+4915123456789', network: 'MTN' }).expect(400);
  await put(ctx, driver, path, { name: ' ', number: '0241234567', network: 'MTN' }).expect(400);
  const { body } = await put(ctx, driver, path, { name: 'Kofi Mensah', number: '+233 24 123 4567', network: 'MTN' }).expect(200);
  assert.deepEqual(body.account, {
    method: 'mobile_money', provider: 'test', accountName: 'Kofi Mensah', accountNumber: '024•••4567',
    network: 'MTN', networkLabel: 'MTN MoMo', ready: true,
  });
  assert.equal(body.onboardingUrl, null);
  assert.equal(ctx.payoutsRepo.payoutAccounts.get(driver.id).accountNumber, '0241234567');
  assert.deepEqual((await get(ctx, driver, '/drivers/me/payouts')).body.account, body.account);

  const rider = await makeUser(ctx, 'rider');
  await put(ctx, rider, path, {}).expect(403);
});

test('Pay now sends the driver their whole balance', async () => {
  const ctx = setup();
  const admin = await makeUser(ctx, 'admin');
  const driver = await makeUser(ctx, 'driver');
  await appRide(ctx, driver, 10000);
  const payNow = () => post(ctx, admin, `/admin/drivers/${driver.id}/payout`);

  assert.match((await payNow().expect(409)).body.error, /set up payouts/);
  await put(ctx, driver, '/drivers/me/payout-account', { name: 'Kofi', number: '0241234567', network: 'VOD' }).expect(200);
  const { body } = await payNow().expect(201);
  assert.equal(body.payout.amount, 8500);
  assert.equal(body.payout.status, 'paid');
  assert.equal(body.payout.requestedBy, admin.id);
  assert.equal(await balance(ctx, driver), 0);
  assert.equal(ctx.notifier.eventsFor(driver.id, 'payout:updated').length, 1);
  assert.match((await payNow().expect(409)).body.error, /nothing/);

  const history = (await get(ctx, driver, '/drivers/me/payouts')).body.payouts;
  assert.deepEqual(history.map((p) => [p.amount, p.status]), [[8500, 'paid']]);
  assert.equal((await get(ctx, admin, '/admin/payouts?status=paid')).body.payouts.length, 1);
  await get(ctx, admin, '/admin/payouts?status=lost').expect(400);
  await post(ctx, driver, `/admin/drivers/${driver.id}/payout`).expect(403);
});

test('a failed payout puts the money back on the balance', async () => {
  const ctx = setup();
  const admin = await makeUser(ctx, 'admin');
  const driver = await driverWithMomo(ctx);
  await appRide(ctx, driver, 10000);
  ctx.testCheckout.failNextTransfer();
  const { body } = await post(ctx, admin, `/admin/drivers/${driver.id}/payout`).expect(201);
  assert.equal(body.payout.status, 'failed');
  assert.equal(body.payout.failureReason, 'Test transfer failed');
  assert.equal(await balance(ctx, driver), 8500);
  assert.equal((await post(ctx, admin, `/admin/drivers/${driver.id}/payout`).expect(201)).body.payout.status, 'paid');
});

test('drivers who owe Pick commission are not paid', async () => {
  const ctx = setup();
  const admin = await makeUser(ctx, 'admin');
  const driver = await driverWithMomo(ctx);
  await ctx.paymentsRepo.create({
    tripId: randomUUID(), riderId: randomUUID(), driverId: driver.id, method: 'cash', provider: null,
    amount: 10000, commission: 1500, currency: 'GHS', status: 'cash',
  });
  await post(ctx, admin, `/admin/drivers/${driver.id}/payout`).expect(409);
  assert.deepEqual(await ctx.payouts.runDue(), { paid: 0, pending: 0, failed: 0, checked: 0 });
});

test('the weekly run pays drivers owed the minimum, once a week', async () => {
  const ctx = setup();
  const ama = await driverWithMomo(ctx);
  const kofi = await driverWithMomo(ctx);
  const esi = await driverWithMomo(ctx);
  await appRide(ctx, ama, 5000); // owed 42.50
  await appRide(ctx, kofi, 1000); // owed 8.50, under the GHS 20 minimum
  await appRide(ctx, esi, 5000);
  ctx.drivers.drivers.get(esi.id).approved = false; // suspended drivers wait for an admin

  assert.deepEqual(await ctx.payouts.runDue(), { paid: 1, pending: 0, failed: 0, checked: 0 });
  assert.equal(await balance(ctx, ama), 0);
  assert.equal(await balance(ctx, kofi), 850);
  assert.equal(await balance(ctx, esi), 4250);
  assert.equal(ctx.payoutsRepo.payouts.size, 1);
  assert.equal([...ctx.payoutsRepo.payouts.values()][0].requestedBy, null);

  await appRide(ctx, ama, 5000);
  ctx.days(3);
  assert.equal((await ctx.payouts.runDue()).paid, 0); // paid 3 days ago
  ctx.days(4);
  assert.equal((await ctx.payouts.runDue()).paid, 1);
  assert.equal(await balance(ctx, ama), 0);
});

test('a payout whose outcome is unknown stays pending until checked', async () => {
  const ctx = setup();
  const admin = await makeUser(ctx, 'admin');
  const driver = await driverWithMomo(ctx);
  await appRide(ctx, driver, 10000);
  const { transfer } = ctx.testCheckout;
  ctx.testCheckout.transfer = async () => { throw new Error('socket hang up'); };

  const { body } = await post(ctx, admin, `/admin/drivers/${driver.id}/payout`).expect(201);
  assert.equal(body.payout.status, 'pending');
  assert.equal(await balance(ctx, driver), 0); // not paid out twice while we find out
  assert.match((await post(ctx, admin, `/admin/drivers/${driver.id}/payout`).expect(409)).body.error, /on its way/);

  ctx.testCheckout.transfer = transfer;
  assert.equal((await ctx.payouts.runDue()).checked, 0); // too soon to chase
  ctx.minutes(20);
  assert.equal((await ctx.payouts.runDue()).checked, 1);
  assert.equal(ctx.payoutsRepo.payouts.get(body.payout.id).status, 'paid');
});

test('Paystack: transfer webhooks settle a pending payout', async () => {
  const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ data: { status: 'pending' } }) });
  const paystack = paystackProvider({ secretKey: 'sk_test_1', fetchFn });
  const ctx = setup({ providers: { paystack } });
  const driver = await driverWithMomo(ctx);
  await appRide(ctx, driver, 10000);
  const payout = await ctx.payouts.payDriver(driver.id);
  assert.equal(payout.status, 'pending');
  assert.equal(payout.providerRef, `pick-payout-${payout.id}`);

  const send = (event) => {
    const body = JSON.stringify({ event, data: { reference: `pick-payout-${payout.id}` } });
    const signature = createHmac('sha512', 'sk_test_1').update(body).digest('hex');
    return request(ctx.app).post('/payments/webhooks/paystack')
      .set('Content-Type', 'application/json').set('x-paystack-signature', signature).send(body);
  };
  await send('transfer.failed').expect(200);
  assert.equal(ctx.payoutsRepo.payouts.get(payout.id).status, 'failed');
  assert.equal(await balance(ctx, driver), 8500);
  await send('transfer.success').expect(200); // too late: a failed payout stays failed
  assert.equal(ctx.payoutsRepo.payouts.get(payout.id).status, 'failed');
});

function recorder(...replies) {
  const calls = [];
  return {
    calls,
    fetchFn: async (url, init = {}) => {
      calls.push({ url, ...init });
      const r = replies.length > 1 ? replies.shift() : replies[0];
      return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body };
    },
  };
}

const payout = { id: '11111111-2222-4333-8444-555555555555', amount: 8500, currency: 'GHS' };

test('Paystack: creates mobile money recipients and sends transfers', async () => {
  const { calls, fetchFn } = recorder(
    { body: { data: { recipient_code: 'RCP_1' } } },
    { body: { data: { status: 'success' } } },
    { body: { data: { status: 'otp' } } },
    { status: 404, body: {} },
  );
  const paystack = paystackProvider({ secretKey: 'sk_test_1', fetchFn });
  assert.deepEqual(
    await paystack.createRecipient({ name: 'Kofi', accountNumber: '0241234567', network: 'MTN', currency: 'GHS' }),
    { ref: 'RCP_1', ready: true },
  );
  assert.equal(calls[0].url, 'https://api.paystack.co/transferrecipient');
  assert.deepEqual(JSON.parse(calls[0].body), {
    type: 'mobile_money', name: 'Kofi', account_number: '0241234567', bank_code: 'MTN', currency: 'GHS',
  });

  const account = { providerRef: 'RCP_1' };
  assert.deepEqual(await paystack.transfer({ payout, account }), { ref: `pick-payout-${payout.id}`, status: 'paid' });
  const sent = JSON.parse(calls[1].body);
  assert.equal(sent.recipient, 'RCP_1');
  assert.equal(sent.amount, 8500);
  assert.equal(sent.source, 'balance');
  assert.match(sent.reference, /^[a-z0-9_-]{16,50}$/);
  const otp = await paystack.transfer({ payout, account });
  assert.equal(otp.status, 'failed');
  assert.match(otp.reason, /OTP/);
  assert.equal((await paystack.checkTransfer({ payout })).status, 'failed');
  assert.equal(calls[3].url, `https://api.paystack.co/transfer/verify/pick-payout-${payout.id}`);

  const body = Buffer.from(JSON.stringify({ event: 'transfer.success', data: { reference: `pick-payout-${payout.id}` } }));
  const signature = createHmac('sha512', 'sk_test_1').update(body).digest('hex');
  assert.deepEqual(paystack.parseWebhook(body, { 'x-paystack-signature': signature }), {
    kind: 'payout', payoutId: payout.id, status: 'paid',
  });
});

test('Stripe: Connect sign-up and transfers', async () => {
  const { calls, fetchFn } = recorder(
    { body: { id: 'acct_1' } },
    { body: { url: 'https://connect.stripe.com/setup/e/acct_1/abc' } },
    { body: { capabilities: { transfers: 'active' }, payouts_enabled: true } },
    { body: { id: 'tr_1' } },
    { status: 400, body: { error: { message: 'Insufficient funds' } } },
    { status: 503, body: {} },
  );
  const stripe = stripeProvider({ secretKey: 'sk_test_2', webhookSecret: 'whsec_1', fetchFn });
  assert.deepEqual(await stripe.createRecipient({ driverId: 'driver-1' }), { ref: 'acct_1', ready: false });
  const form = new URLSearchParams(calls[0].body.toString());
  assert.equal(form.get('type'), 'express');
  assert.equal(form.get('country'), 'DE');
  assert.equal(form.get('capabilities[transfers][requested]'), 'true');

  assert.equal(await stripe.onboardingLink('acct_1', { returnUrl: 'http://pick.test/payments/payout-return' }),
    'https://connect.stripe.com/setup/e/acct_1/abc');
  assert.equal(new URLSearchParams(calls[1].body.toString()).get('type'), 'account_onboarding');
  assert.equal(await stripe.recipientReady('acct_1'), true);

  const eur = { ...payout, currency: 'EUR' };
  assert.deepEqual(await stripe.transfer({ payout: eur, account: { providerRef: 'acct_1' } }), { ref: 'tr_1', status: 'paid' });
  assert.equal(calls[3].headers['Idempotency-Key'], `payout-${payout.id}`);
  assert.equal(new URLSearchParams(calls[3].body.toString()).get('destination'), 'acct_1');
  assert.deepEqual(await stripe.transfer({ payout: eur, account: { providerRef: 'acct_1' } }), {
    ref: null, status: 'failed', reason: 'Stripe: Insufficient funds',
  });
  await assert.rejects(stripe.transfer({ payout: eur, account: { providerRef: 'acct_1' } }), /503/);
});

test('a German driver signs up for payouts on Stripe\'s page', async () => {
  let ready = false;
  const stripe = {
    name: 'stripe',
    createRecipient: async () => ({ ref: 'acct_9', ready: false }),
    onboardingLink: async (ref, { returnUrl }) => `https://connect.stripe.com/${ref}?return=${returnUrl}`,
    recipientReady: async () => ready,
  };
  const ctx = setup({ providers: { stripe } });
  const driver = await makeUser(ctx, 'driver', 'DE');

  const first = await put(ctx, driver, '/drivers/me/payout-account', {}).expect(200);
  assert.equal(first.body.account.ready, false);
  assert.equal(first.body.onboardingUrl, 'https://connect.stripe.com/acct_9?return=http://pick.test/payments/payout-return');
  const info = (await get(ctx, driver, '/drivers/me/payouts')).body;
  assert.equal(info.account.ready, false);
  assert.deepEqual(info.networks, []);
  assert.equal(info.schedule.currency, 'EUR');

  ready = true; // the driver finished Stripe's sign-up
  assert.equal((await get(ctx, driver, '/drivers/me/payouts')).body.account.ready, true);
  const again = await put(ctx, driver, '/drivers/me/payout-account', {}).expect(200);
  assert.equal(again.body.onboardingUrl, null);
});
