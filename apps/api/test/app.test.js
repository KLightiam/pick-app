import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

test('GET /health', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('POST /trips/estimate returns a fare', async () => {
  const res = await request(app)
    .post('/trips/estimate')
    .send({ pickup: { lat: 5.6037, lng: -0.187 }, dropoff: { lat: 5.65, lng: -0.17 } });
  assert.equal(res.status, 200);
  assert.ok(res.body.fare >= 800);
  assert.ok(res.body.distanceKm > 0);
});

test('POST /trips/estimate rejects bad input', async () => {
  const res = await request(app).post('/trips/estimate').send({ pickup: { lat: 5 } });
  assert.equal(res.status, 400);
});

test('GET /drivers/nearby validates coordinates', async () => {
  const res = await request(app).get('/drivers/nearby?lat=abc&lng=1');
  assert.equal(res.status, 400);
});
