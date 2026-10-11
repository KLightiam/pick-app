import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_CATEGORIES, ratingSummary } from '../src/index.js';

test('ratings average to one decimal', () => {
  assert.equal(ratingSummary([]), null);
  assert.deepEqual(ratingSummary([5]), { average: 5, count: 1 });
  assert.deepEqual(ratingSummary([5, 4, 4]), { average: 4.3, count: 3 });
});

test('safety reports come first', () => {
  assert.equal(REPORT_CATEGORIES[0].code, 'safety');
  assert.equal(new Set(REPORT_CATEGORIES.map((c) => c.code)).size, REPORT_CATEGORIES.length);
});
