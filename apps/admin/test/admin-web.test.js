import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.js';
import { describeBalance, describePayment, formatMoney, parseMoney } from '../src/format.js';

test('admin API calls carry the token and build filters into the URL', async () => {
  const calls = [];
  const fetchFn = async (url, init) => { calls.push({ url, ...init }); return { status: 200, ok: true, json: async () => ({}) }; };
  const api = createApi({ baseUrl: 'http://api', getToken: () => 'tok', fetchFn });
  await api.drivers({ status: 'pending', q: '', country: 'GH' });
  await api.overview({ days: 7 });
  await api.setApproval('d1', false);
  await api.recordSettlement({ driverId: 'd1', direction: 'to_driver', amount: 2411 });
  await api.payouts({ status: 'failed' });
  await api.payDriver('d1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET http://api/admin/drivers?status=pending&country=GH',
    'GET http://api/admin/overview?days=7',
    'POST http://api/admin/drivers/d1/approval',
    'POST http://api/admin/settlements',
    'GET http://api/admin/payouts?status=failed',
    'POST http://api/admin/drivers/d1/payout',
  ]);
  assert.equal(calls[0].headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[2].body), { approved: false });
});

test('API errors keep the status and message', async () => {
  const fetchFn = async () => ({ status: 403, ok: false, json: async () => ({ error: 'only admins can do this' }) });
  const api = createApi({ baseUrl: 'http://api', fetchFn });
  await assert.rejects(api.overview({}), (e) => e.status === 403 && e.message === 'only admins can do this');
});

test('money in and out', () => {
  assert.equal(formatMoney(2837, 'GHS'), 'GH₵28.37');
  assert.equal(formatMoney(-426, 'EUR'), '−€4.26');
  assert.equal(parseMoney('24.11'), 2411);
  assert.equal(parseMoney('24,5'), 2450);
  assert.equal(parseMoney('30'), 3000);
  assert.equal(parseMoney('0'), null);
  assert.equal(parseMoney('-5'), null);
  assert.equal(parseMoney('1.234'), null);
  assert.equal(parseMoney('abc'), null);
});

test('balances and payments in words', () => {
  assert.equal(describeBalance(2411, 'GHS'), 'Pick owes GH₵24.11');
  assert.equal(describeBalance(-426, 'GHS'), 'Owes Pick GH₵4.26');
  assert.equal(describeBalance(0, 'GHS'), 'Settled');
  assert.equal(describePayment({ status: 'completed', paymentMethod: 'app', paymentStatus: 'pending' }), 'App · unpaid');
  assert.equal(describePayment({ status: 'completed', paymentMethod: 'cash' }), 'Cash');
  assert.equal(describePayment({ status: 'requested', paymentMethod: 'app' }), 'App');
});

test('document files are fetched with the sign-in header', async () => {
  const calls = [];
  const fetchFn = async (url, init) => { calls.push({ url, ...init }); return { ok: true, blob: async () => 'BLOB' }; };
  const api = createApi({ baseUrl: 'http://api', getToken: () => 'tok', fetchFn });
  assert.equal(await api.documentFile('doc1'), 'BLOB');
  assert.equal(calls[0].url, 'http://api/admin/documents/doc1/file');
  assert.equal(calls[0].headers.Authorization, 'Bearer tok');
});
