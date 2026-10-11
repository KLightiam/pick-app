import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driverBalance, getMarket, splitEarnings } from '../src/index.js';

test('commission is taken from the fare and the driver keeps the rest', () => {
  assert.deepEqual(splitEarnings(2837, 0.15), { commission: 426, driverEarnings: 2411 });
  assert.deepEqual(splitEarnings(0, 0.15), { commission: 0, driverEarnings: 0 });
});

test('both markets allow cash and app payments with a commission rate', () => {
  for (const c of ['GH', 'DE']) {
    assert.deepEqual([...getMarket(c).paymentMethods], ['cash', 'app']);
    assert.ok(getMarket(c).commissionRate > 0 && getMarket(c).commissionRate < 1);
  }
});

test('the balance nets app earnings against commission owed on cash rides', () => {
  const balance = driverBalance([
    { method: 'app', status: 'paid', amount: 2000, commission: 300 },
    { method: 'app', status: 'pending', amount: 1000, commission: 150 }, // not paid yet: doesn't count
    { method: 'cash', status: 'cash', amount: 1500, commission: 225 },
  ]);
  assert.deepEqual(balance, { owedToDriver: 1700, cashCollected: 1500, commissionOnCash: 225, balance: 1475 });
});
