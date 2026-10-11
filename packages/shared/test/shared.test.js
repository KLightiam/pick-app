import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, estimateFare, canTransition, isValidPoint } from '../src/index.js';

test('distanceKm is about 111 km per degree of latitude', () => {
  const d = distanceKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(d - 111.2) < 0.5);
});

test('estimateFare applies the minimum fare for very short trips', () => {
  const p = { lat: 5.6037, lng: -0.187 };
  assert.equal(estimateFare(p, p).fare, 800);
});

test('estimateFare grows with distance', () => {
  const a = { lat: 5.6037, lng: -0.187 };
  const near = estimateFare(a, { lat: 5.62, lng: -0.187 });
  const far = estimateFare(a, { lat: 5.7, lng: -0.187 });
  assert.ok(far.fare > near.fare);
});

test('trip status transitions', () => {
  assert.ok(canTransition('requested', 'accepted'));
  assert.ok(!canTransition('completed', 'requested'));
  assert.ok(!canTransition('in_progress', 'cancelled'));
});

test('isValidPoint rejects bad coordinates', () => {
  assert.ok(isValidPoint({ lat: 1, lng: 2 }));
  assert.ok(!isValidPoint({ lat: 91, lng: 0 }));
  assert.ok(!isValidPoint({ lat: '1', lng: 2 }));
});
