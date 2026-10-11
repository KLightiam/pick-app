import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { testApp, memoryDb } from './helpers.js';
import { osrmRouter, straightRouter, withFallback, createRouting } from '../src/routing/index.js';
import { createRouteKeeper } from '../src/drivers/routeKeeper.js';

const KM = 1 / 110.6;
const at = (east, north = 0) => ({ lat: 5.6 + north * KM, lng: -0.25 + east * KM });

// A response in OSRM's format, as returned by /route/v1/driving with geometries=geojson
const osrmResponse = {
  code: 'Ok',
  routes: [{ distance: 12345, duration: 1260, geometry: { type: 'LineString', coordinates: [[-0.187, 5.6037], [-0.15, 5.62], [-0.0166, 5.6698]] } }],
};

test('osrmRouter asks OSRM for a driving route and reads the road points back', async () => {
  let asked;
  const router = osrmRouter({
    baseUrl: 'https://osrm.example.com/',
    fetchFn: async (url) => { asked = url; return { ok: true, json: async () => osrmResponse }; },
  });
  const route = await router.route({ lat: 5.6037, lng: -0.187 }, { lat: 5.6698, lng: -0.0166 });
  assert.equal(asked, 'https://osrm.example.com/route/v1/driving/-0.187,5.6037;-0.0166,5.6698?overview=simplified&geometries=geojson');
  assert.deepEqual(route.points, [{ lat: 5.6037, lng: -0.187 }, { lat: 5.62, lng: -0.15 }, { lat: 5.6698, lng: -0.0166 }]);
  assert.equal(route.distanceKm, 12.345);
  assert.equal(route.durationMin, 21);
  assert.equal(route.source, 'osrm');
});

test('osrmRouter fails clearly when OSRM is down or finds no road', async () => {
  const down = osrmRouter({ baseUrl: 'https://osrm.example.com', fetchFn: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(down.route(at(0), at(1)), /503/);
  const noRoad = osrmRouter({
    baseUrl: 'https://osrm.example.com',
    fetchFn: async () => ({ ok: true, json: async () => ({ code: 'NoRoute', routes: [] }) }),
  });
  await assert.rejects(noRoad.route(at(0), at(1)), /NoRoute/);
});

test('if routing fails, drivers still get a straight-line route', async () => {
  const warnings = [];
  const router = withFallback({ route: async () => { throw new Error('timeout'); } }, straightRouter(), {
    warn: (m) => warnings.push(m),
  });
  const route = await router.route(at(0), at(5));
  assert.deepEqual(route.points, [at(0), at(5)]);
  assert.equal(route.source, 'straight');
  assert.match(warnings[0], /timeout/);
  assert.equal((await createRouting({ provider: 'straight' }).route(at(0), at(1))).source, 'straight');
});

/** A routing service with a fixed road layout: east 5 km, then north to the destination. */
const bendRouter = { route: async (from, to) => ({ points: [from, at(5), to], source: 'test' }) };

async function commuter(ctx, location, destination) {
  const user = await ctx.users.create({ phone: `+2332460${Math.floor(Math.random() * 1e5)}`, country: 'GH', role: 'driver', name: 'Kofi' });
  ctx.drivers.drivers.get(user.id).approved = true;
  const auth = `Bearer ${ctx.tokens.sign(user)}`;
  const res = await request(ctx.app).post('/drivers/me/status').set('Authorization', auth)
    .send({ online: true, location, mode: 'commute', destination });
  return { ...user, auth, res };
}

async function rider(ctx) {
  const user = await ctx.users.create({ phone: `+2332470${Math.floor(Math.random() * 1e5)}`, country: 'GH', role: 'rider' });
  return { ...user, auth: `Bearer ${ctx.tokens.sign(user)}` };
}

test('commuters are matched along their road route, not a straight line', async () => {
  const ctx = testApp({ routing: bendRouter });
  const driver = await commuter(ctx, at(0), at(5, 8));
  assert.equal(driver.res.status, 200);
  assert.equal(driver.res.body.route.points.length, 3);
  const ama = await rider(ctx);

  // Pickup and drop-off are on the road east, far from the straight line to the destination
  const res = await request(ctx.app).post('/trips/options').set('Authorization', ama.auth)
    .send({ pickup: at(2), dropoff: at(5, 3) });
  assert.equal(res.body.options.length, 1);
  assert.equal(res.body.options[0].matchType, 'beyond');

  // With straight lines the same commuter would not have matched
  const straight = testApp();
  await commuter(straight, at(0), at(5, 8));
  const none = await request(straight.app).post('/trips/options').set('Authorization', (await rider(straight)).auth)
    .send({ pickup: at(2), dropoff: at(5, 3) });
  assert.equal(none.body.options.length, 0);
});

test('a commuter who has already driven past the pickup is not offered it', async () => {
  const ctx = testApp({ routing: bendRouter });
  const driver = await commuter(ctx, at(0), at(5, 8));
  await ctx.drivers.updateLocation(driver.id, at(5, 1)); // round the bend
  const res = await request(ctx.app).post('/trips/options').set('Authorization', (await rider(ctx)).auth)
    .send({ pickup: at(2), dropoff: at(5, 6) });
  assert.equal(res.body.options.length, 0);
});

test('a commuter who leaves their route is re-routed, at most once a minute', async () => {
  const { drivers, users } = memoryDb();
  const user = await users.create({ phone: '+233245555555', country: 'GH', role: 'driver' });
  await drivers.setStatus(user.id, {
    online: true, location: at(0), mode: 'commute', destination: at(10), seatsOffered: 1, route: [at(0), at(10)],
  });
  let clock = 0;
  const asked = [];
  const routing = { route: async (from, to) => { asked.push(from); return { points: [from, at(5, 2), to] }; } };
  const keeper = createRouteKeeper({ drivers, routing, now: () => clock });

  assert.equal(await keeper.onLocation(user.id, at(3, 0.2)), false); // still on the road
  assert.equal(await keeper.onLocation(user.id, at(3, 2)), true); // took another road
  assert.deepEqual(asked, [at(3, 2)]);
  assert.deepEqual((await drivers.findById(user.id)).route, [at(3, 2), at(5, 2), at(10)]);

  clock += 30_000;
  assert.equal(await keeper.onLocation(user.id, at(0, -3)), false); // too soon to ask again
  clock += 31_000;
  assert.equal(await keeper.onLocation(user.id, at(0, -3)), true);
});

test('go-anywhere drivers are never re-routed', async () => {
  const { drivers, users } = memoryDb();
  const user = await users.create({ phone: '+233245555556', country: 'GH', role: 'driver' });
  await drivers.setStatus(user.id, { online: true, location: at(0), mode: 'anywhere', seatsOffered: 1 });
  const keeper = createRouteKeeper({ drivers, routing: { route: async () => assert.fail('should not route') } });
  assert.equal(await keeper.onLocation(user.id, at(9, 9)), false);
});
