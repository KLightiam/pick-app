import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { testApp, fakeGeocoder } from './helpers.js';
import { photonGeocoder } from '../src/places/index.js';

// A response in Photon's GeoJSON format
const photonResponse = {
  features: [
    { geometry: { coordinates: [-0.1807, 5.5571] }, properties: { name: 'Osu Castle', street: 'Castle Road', city: 'Accra', state: 'Greater Accra Region', countrycode: 'GH' } },
    { geometry: { coordinates: [13.4, 52.52] }, properties: { name: 'Osu', city: 'Berlin', countrycode: 'DE' } },
    { geometry: { coordinates: [-0.17, 5.56] }, properties: { street: 'Oxford Street', housenumber: '12', district: 'Osu', city: 'Accra', countrycode: 'GH' } },
  ],
};

test('photonGeocoder searches near the user and keeps only places in their country', async () => {
  let asked;
  const geocoder = photonGeocoder({
    baseUrl: 'https://photon.example.com',
    fetchFn: async (url) => { asked = new URL(url); return { ok: true, json: async () => photonResponse }; },
  });
  const places = await geocoder.search('Osu', { country: 'GH', near: { lat: 5.6, lng: -0.19 } });
  assert.equal(asked.pathname, '/api/');
  assert.equal(asked.searchParams.get('q'), 'Osu');
  assert.equal(asked.searchParams.get('lat'), '5.6');
  assert.equal(asked.searchParams.get('lon'), '-0.19');
  assert.deepEqual(places, [
    { name: 'Osu Castle', address: 'Osu Castle, Castle Road, Accra, Greater Accra Region', location: { lat: 5.5571, lng: -0.1807 } },
    { name: 'Oxford Street 12, Osu, Accra', address: 'Oxford Street 12, Osu, Accra', location: { lat: 5.56, lng: -0.17 } },
  ]);
});

test('photonGeocoder fails clearly when the service is down', async () => {
  const geocoder = photonGeocoder({ baseUrl: 'https://photon.example.com', fetchFn: async () => ({ ok: false, status: 500 }) });
  await assert.rejects(geocoder.search('Osu', { country: 'GH' }), /500/);
});

test('GET /places/search needs sign-in and a sensible query', async () => {
  const osu = { name: 'Osu', address: 'Osu, Accra', location: { lat: 5.55, lng: -0.18 } };
  const ctx = testApp({ geocoder: fakeGeocoder([osu]) });
  const user = await ctx.users.create({ phone: '+233249999999', country: 'GH', role: 'rider' });
  const auth = `Bearer ${ctx.tokens.sign(user)}`;
  await request(ctx.app).get('/places/search?q=Osu').expect(401);
  await request(ctx.app).get('/places/search?q=O').set('Authorization', auth).expect(400);
  await request(ctx.app).get('/places/search?q=Osu&lat=x&lng=1').set('Authorization', auth).expect(400);
  const res = await request(ctx.app).get('/places/search?q=osu&lat=5.6&lng=-0.19').set('Authorization', auth).expect(200);
  assert.deepEqual(res.body.places, [osu]);
});

test('GET /places/search says so when address search is down', async () => {
  const ctx = testApp({ geocoder: fakeGeocoder([], { fail: true }) });
  const user = await ctx.users.create({ phone: '+233249999998', country: 'GH', role: 'rider' });
  await request(ctx.app).get('/places/search?q=Osu').set('Authorization', `Bearer ${ctx.tokens.sign(user)}`).expect(502);
});
