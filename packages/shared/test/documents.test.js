import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentChecklist, documentsComplete, getMarket, DOCUMENT_LABELS } from '../src/index.js';

test('each country lists the documents it needs, all with labels', () => {
  assert.ok(getMarket('GH').driverDocuments.includes('roadworthy'));
  assert.ok(getMarket('DE').driverDocuments.includes('passenger_permit'));
  for (const c of ['GH', 'DE']) for (const kind of getMarket(c).driverDocuments) assert.ok(DOCUMENT_LABELS[kind]);
});

test('the checklist shows the latest upload of each kind', () => {
  const docs = [
    { kind: 'licence', status: 'rejected', uploadedAt: '2026-10-01T10:00:00Z' },
    { kind: 'licence', status: 'approved', uploadedAt: '2026-10-02T10:00:00Z' },
    { kind: 'insurance', status: 'pending', uploadedAt: '2026-10-02T11:00:00Z' },
  ];
  const list = documentChecklist(['licence', 'insurance', 'car_photo'], docs);
  assert.deepEqual(list.map((i) => [i.kind, i.document?.status ?? null]), [
    ['licence', 'approved'], ['insurance', 'pending'], ['car_photo', null],
  ]);
  assert.equal(documentsComplete(list), false);
  assert.equal(documentsComplete(documentChecklist(['licence'], docs)), true);
});
