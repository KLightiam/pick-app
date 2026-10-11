import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appPaymentLabel, describeDropoff, describeFare, describePayment, directionsUrl, formatKm, formatMoney, formatRating, liveOffers, secondsLeft,
} from '../src/format.js';

test('money shows in cedis and euros from minor units', () => {
  assert.equal(formatMoney(1350, 'GHS'), 'GH₵13.50');
  assert.equal(formatMoney(799, 'EUR'), '€7.99');
  assert.equal(formatMoney(100, 'USD'), 'USD 1.00');
  assert.equal(formatMoney(null, 'GHS'), '');
});

test('distances under a kilometre show in metres', () => {
  assert.equal(formatKm(0.42), '420 m');
  assert.equal(formatKm(3.25), '3.3 km');
});

test('a solo fare shows one price, a shared fare shows the most and the shared price', () => {
  assert.equal(describeFare({ max: 1300, currency: 'GHS' }), 'GH₵13.00');
  assert.equal(
    describeFare({ max: 1300, ifShared: 1100, currency: 'GHS' }),
    'Up to GH₵13.00 · GH₵11.00 if someone shares',
  );
});

test('partway rides say how far from the destination they stop', () => {
  assert.equal(describeDropoff({ matchType: 'partial', remainingKm: 2.4 }), 'Drops you 2.4 km from your destination');
  assert.equal(describeDropoff({ matchType: 'beyond' }), 'Drops you at your destination');
});

test('expired and repeated offers drop off the list', () => {
  const now = Date.parse('2026-10-11T10:00:00Z');
  const offer = (id, at) => ({ trip: { id }, expiresAt: new Date(at).toISOString() });
  const list = [offer('a', now + 30_000), offer('b', now - 1), offer('a', now + 10_000), offer('c', now + 5_000)];
  assert.deepEqual(liveOffers(list, now).map((o) => o.trip.id), ['a', 'c']);
});

test('seconds left counts down and stops at zero', () => {
  const now = Date.parse('2026-10-11T10:00:00Z');
  assert.equal(secondsLeft(new Date(now + 59_900).toISOString(), now), 59);
  assert.equal(secondsLeft(new Date(now - 5_000).toISOString(), now), 0);
});

test('directions link to the point', () => {
  assert.equal(directionsUrl({ lat: 5.556, lng: -0.182 }), 'https://www.google.com/maps/dir/?api=1&destination=5.556,-0.182');
});

test('payment lines for riders and drivers', () => {
  const cash = { method: 'cash', status: 'cash', amount: 2000, currency: 'GHS' };
  const app = { method: 'app', status: 'pending', amount: 1290, currency: 'EUR' };
  assert.equal(describePayment(cash, 'rider'), 'Pay your driver GH₵20.00 in cash');
  assert.equal(describePayment(cash, 'driver'), 'Collect GH₵20.00 in cash');
  assert.equal(describePayment(app, 'rider'), '€12.90 to pay in the app');
  assert.equal(describePayment({ ...app, status: 'paid' }, 'driver'), '€12.90 paid in the app');
  assert.equal(appPaymentLabel('GH'), 'Card or MoMo');
  assert.equal(appPaymentLabel('DE'), 'Card');
});

test('ratings show the average and count, or that the driver is new', () => {
  assert.equal(formatRating({ average: 4.5, count: 2 }), '★ 4.5 (2)');
  assert.equal(formatRating({ average: 5, count: 1 }), '★ 5.0 (1)');
  assert.equal(formatRating(null), 'New driver');
  assert.equal(formatRating(null, 'No ratings yet'), 'No ratings yet');
});
