import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { testApp } from './helpers.js';

const { app } = testApp();

test('GET /health', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('POST /trips/estimate returns a fare in the market currency', async () => {
  const trip = { pickup: { lat: 5.6037, lng: -0.187 }, dropoff: { lat: 5.65, lng: -0.17 } };
  const gh = await request(app).post('/trips/estimate').send({ country: 'GH', ...trip });
  assert.equal(gh.status, 200);
  assert.equal(gh.body.currency, 'GHS');
  assert.ok(gh.body.fare >= 1000);

  const de = await request(app).post('/trips/estimate').send({ country: 'DE', ...trip });
  assert.equal(de.body.currency, 'EUR');
});

test('POST /trips/estimate rejects bad input', async () => {
  const noCountry = await request(app).post('/trips/estimate')
    .send({ pickup: { lat: 5, lng: 0 }, dropoff: { lat: 5.1, lng: 0 } });
  assert.equal(noCountry.status, 400);
  const badPoint = await request(app).post('/trips/estimate').send({ country: 'GH', pickup: { lat: 5 } });
  assert.equal(badPoint.status, 400);
});

test('GET /drivers/nearby validates coordinates', async () => {
  const res = await request(app).get('/drivers/nearby?lat=abc&lng=1');
  assert.equal(res.status, 400);
});
