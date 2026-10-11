import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARKETS, MOBILE_MONEY_NETWORKS, ghanaMobileMoneyNumber, maskAccountNumber } from '../src/index.js';

test('Ghanaian mobile numbers become the local form Paystack expects', () => {
  assert.equal(ghanaMobileMoneyNumber('+233 24 123 4567'), '0241234567');
  assert.equal(ghanaMobileMoneyNumber('024 123 4567'), '0241234567');
  assert.equal(ghanaMobileMoneyNumber('0551234567'), '0551234567');
  assert.equal(ghanaMobileMoneyNumber('+49 151 23456789'), null); // German number
  assert.equal(ghanaMobileMoneyNumber('12345'), null);
  assert.equal(ghanaMobileMoneyNumber(undefined), null);
});

test('account numbers are masked for display', () => {
  assert.equal(maskAccountNumber('0241234567'), '024•••4567');
  assert.equal(maskAccountNumber(null), '');
});

test('each market says how drivers are paid', () => {
  assert.equal(MARKETS.GH.payout.method, 'mobile_money');
  assert.equal(MARKETS.DE.payout.method, 'stripe');
  for (const m of Object.values(MARKETS)) {
    assert.ok(m.payout.minimum > 0 && m.payout.everyDays > 0);
  }
  assert.deepEqual(MOBILE_MONEY_NETWORKS.map((n) => n.code), ['MTN', 'VOD', 'ATL']);
});
