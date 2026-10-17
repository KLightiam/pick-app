import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApi } from '../src/api.js';

function recorder(response) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, ...init });
    if (response instanceof Error) throw response;
    return response;
  };
  return { calls, fetchFn };
}

const json = (status, body) => ({ status, ok: status < 400, json: async () => body });

test('sends the token and a JSON body, and returns the parsed reply', async () => {
  const { calls, fetchFn } = recorder(json(200, { options: [] }));
  const api = createApi({ baseUrl: 'http://api', getToken: async () => 'tok', fetchFn });

  const result = await api.rideOptions({ pickup: { lat: 5.6, lng: -0.2 } });

  assert.deepEqual(result, { options: [] });
  assert.equal(calls[0].url, 'http://api/trips/options');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer tok');
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].body), { pickup: { lat: 5.6, lng: -0.2 } });
});

test('signed-out calls and GETs carry no auth or body', async () => {
  const { calls, fetchFn } = recorder(json(200, { user: {} }));
  const api = createApi({ baseUrl: 'http://api', getToken: async () => null, fetchFn });
  await api.me();
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].body, undefined);
  assert.deepEqual(calls[0].headers, {});
});

test('place search puts the query and nearby point in the URL, skipping missing values', async () => {
  const { calls, fetchFn } = recorder(json(200, { places: [] }));
  const api = createApi({ baseUrl: 'http://api', fetchFn });
  await api.searchPlaces('Osu Oxford St', { lat: 5.55, lng: -0.18 });
  await api.searchPlaces('Kotoka');
  assert.equal(calls[0].url, 'http://api/places/search?q=Osu+Oxford+St&lat=5.55&lng=-0.18');
  assert.equal(calls[1].url, 'http://api/places/search?q=Kotoka');
});

test('a 204 reply returns null', async () => {
  const { fetchFn } = recorder({ status: 204, ok: true, json: async () => { throw new Error('no body'); } });
  const api = createApi({ baseUrl: 'http://api', fetchFn });
  assert.equal(await api.requestCode('+233241234567'), null);
});

test('API errors carry the status and the server message', async () => {
  const { fetchFn } = recorder(json(409, { error: 'You already have an active trip' }));
  const api = createApi({ baseUrl: 'http://api', fetchFn });
  await assert.rejects(api.book({}), (err) => err instanceof ApiError
    && err.status === 409 && err.message === 'You already have an active trip');
});

test('a network failure becomes a friendly ApiError with status 0', async () => {
  const { fetchFn } = recorder(new TypeError('Network request failed'));
  const api = createApi({ baseUrl: 'http://api', fetchFn });
  await assert.rejects(api.activeTrips(), (err) => err.status === 0 && /Can't reach Pick/.test(err.message));
});

test('in development, a network failure names the address it tried', async () => {
  const { fetchFn } = recorder(new TypeError('Network request failed'));
  const api = createApi({ baseUrl: 'http://192.168.1.23:4000', fetchFn, showAddress: true });
  await assert.rejects(api.activeTrips(), (err) => err.status === 0 && err.message.includes('http://192.168.1.23:4000'));
});

test('trip actions hit the right paths', async () => {
  const { calls, fetchFn } = recorder(json(200, {}));
  const api = createApi({ baseUrl: 'http://api', fetchFn });
  const id = '00000000-0000-4000-8000-000000000001';
  await api.accept(id);
  await api.arrived(id);
  await api.start(id);
  await api.complete(id);
  await api.cancel(id, 'changed plans');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.replace('http://api', '')}`), [
    `POST /trips/${id}/accept`,
    `POST /trips/${id}/arrived`,
    `POST /trips/${id}/start`,
    `POST /trips/${id}/complete`,
    `POST /trips/${id}/cancel`,
  ]);
  assert.deepEqual(JSON.parse(calls[4].body), { reason: 'changed plans' });
});

test('payment calls hit the right paths', async () => {
  const { calls, fetchFn } = recorder(json(200, {}));
  const api = createApi({ baseUrl: 'http://api', fetchFn });
  await api.pay('t1');
  await api.payment('t1');
  await api.unpaid();
  await api.earnings(30);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.replace('http://api', '')}`), [
    'POST /trips/t1/pay', 'GET /trips/t1/payment', 'GET /payments/unpaid', 'GET /drivers/me/earnings?days=30',
  ]);
});

test('document uploads send the file as-is with its type', async () => {
  const { calls, fetchFn } = recorder(json(201, { document: {} }));
  const api = createApi({ baseUrl: 'http://api', getToken: async () => 'tok', fetchFn });
  const file = new Uint8Array([0xff, 0xd8, 0xff]);
  await api.uploadDocument('licence', file, 'image/jpeg');
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].url, 'http://api/drivers/me/documents/licence');
  assert.equal(calls[0].headers['Content-Type'], 'image/jpeg');
  assert.equal(calls[0].headers.Authorization, 'Bearer tok');
  assert.equal(calls[0].body, file);
});

test('payout details go to the payout account endpoint', async () => {
  const { calls, fetchFn } = recorder(json(200, { account: {}, onboardingUrl: null }));
  const api = createApi({ baseUrl: 'http://api', getToken: async () => 'tok', fetchFn });
  await api.setupPayouts({ network: 'MTN', number: '0241234567', name: 'Kofi' });
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].url, 'http://api/drivers/me/payout-account');
  assert.deepEqual(JSON.parse(calls[0].body), { network: 'MTN', number: '0241234567', name: 'Kofi' });
});

test('push tokens are registered and removed through /auth/push-token', async () => {
  const { calls, fetchFn } = recorder(json(204, null));
  const api = createApi({ baseUrl: 'http://api', getToken: async () => 'tok', fetchFn });
  await api.registerPushToken('ExponentPushToken[abc]', 'android');
  await api.unregisterPushToken('ExponentPushToken[abc]');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'PUT http://api/auth/push-token', 'DELETE http://api/auth/push-token',
  ]);
  assert.deepEqual(JSON.parse(calls[0].body), { token: 'ExponentPushToken[abc]', platform: 'android' });
});
