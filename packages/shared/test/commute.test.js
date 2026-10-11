import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceKm, projectOntoRoute, routeLengthKm, matchCommute, matchAnywhere, rankMatches,
  quoteFare, splitFares, PRICE_RULES,
} from '../src/index.js';

// A commuter driving ~11 km due east along latitude 5.60 (around Accra).
const KM = 1 / 110.6; // ~1 km in degrees (latitude, and longitude near the equator)
const at = (kmEast, kmNorth = 0) => ({ lat: 5.6 + kmNorth * KM, lng: -0.25 + kmEast * KM });
const ROUTE = [at(0), at(11)];

test('routeLengthKm and projectOntoRoute agree with straight-line distance', () => {
  assert.ok(Math.abs(routeLengthKm(ROUTE) - distanceKm(ROUTE[0], ROUTE[1])) < 0.05);
  const p = projectOntoRoute(ROUTE, at(4, 0.5));
  assert.ok(Math.abs(p.alongKm - 4) < 0.1);
  assert.ok(Math.abs(p.crossKm - 0.5) < 0.05);
  // Restricting to the route after 6 km snaps to the 6 km point
  const later = projectOntoRoute(ROUTE, at(4, 0.5), { minAlongKm: 6 });
  assert.ok(Math.abs(later.alongKm - 6) < 0.01);
});

test('projectOntoRoute works along a route with a bend', () => {
  const bent = [at(0), at(5), at(5, 5)];
  const p = projectOntoRoute(bent, at(5.3, 3));
  assert.ok(Math.abs(p.alongKm - 8) < 0.15);
  assert.ok(Math.abs(p.crossKm - 0.3) < 0.05);
});

test('exact: the commuter is going to the passenger\'s destination', () => {
  const m = matchCommute(ROUTE, at(2, 0.3), at(11, 0.5));
  assert.equal(m.matchType, 'exact');
  assert.deepEqual(m.alight, at(11, 0.5));
  assert.equal(m.remainingKm, 0);
});

test('beyond: the commuter passes the passenger\'s destination and keeps going', () => {
  const m = matchCommute(ROUTE, at(2), at(7, -0.4));
  assert.equal(m.matchType, 'beyond');
  assert.ok(Math.abs(m.alightKm - 7) < 0.1);
  assert.ok(Math.abs(m.rideKm - 5) < 0.2);
});

test('partial: the commuter turns off before the destination, so the passenger gets off partway', () => {
  // Destination is 4 km north of the route's end: the closest the driver gets is their own destination
  const m = matchCommute(ROUTE, at(1), at(11, 4));
  assert.equal(m.matchType, 'partial');
  assert.ok(Math.abs(m.alightKm - 11) < 0.1);
  assert.ok(Math.abs(m.remainingKm - 4) < 0.2);
  // ...and is priced on where they get off, not on where they wanted to go
  assert.ok(Math.abs(m.rideKm - 10) < 0.2);
});

test('no match when the pickup is far from the route, behind it, or the ride barely helps', () => {
  assert.equal(matchCommute(ROUTE, at(3, 2), at(9)), null); // pickup 2 km off the route
  assert.equal(matchCommute(ROUTE, at(8), at(3)), null); // going the opposite way
  assert.equal(matchCommute(ROUTE, at(10.5), at(10.5, 8)), null); // heading north, route goes east
});

test('go-anywhere drivers match within 5 km of the pickup', () => {
  assert.equal(matchAnywhere(at(0), at(3), at(20)).matchType, 'anywhere');
  assert.equal(matchAnywhere(at(0), at(8), at(20)), null);
});

test('options rank exact, then beyond, then partial, then go-anywhere, nearest first', () => {
  const ranked = rankMatches([
    { id: 'a', matchType: 'anywhere', pickupKm: 0.2 },
    { id: 'p', matchType: 'partial', pickupKm: 0.1 },
    { id: 'b2', matchType: 'beyond', pickupKm: 2 },
    { id: 'e', matchType: 'exact', pickupKm: 3 },
    { id: 'b1', matchType: 'beyond', pickupKm: 1 },
  ]);
  assert.deepEqual(ranked.map((o) => o.id), ['e', 'b1', 'b2', 'p', 'a']);
});

test('quotes: commuters charge 65% when alone; shared rides show what they could drop to', () => {
  assert.deepEqual(quoteFare({ driverMode: 'commute', usual: 2000, rideType: 'solo' }), { max: 1300 });
  assert.deepEqual(quoteFare({ driverMode: 'commute', usual: 2000, rideType: 'shared' }), { max: 1300, ifShared: 1100 });
  assert.deepEqual(quoteFare({ driverMode: 'anywhere', usual: 2000, rideType: 'solo' }), { max: 2000 });
  assert.deepEqual(quoteFare({ driverMode: 'anywhere', usual: 2000, rideType: 'shared' }), { max: 2000, ifShared: 1000 });
});

test('alone with a commuter, a passenger pays 65% of the usual fare', () => {
  const fares = splitFares({ driverMode: 'commute', passengers: [{ id: 'a', startKm: 0, endKm: 10, usual: 2000 }] });
  assert.deepEqual(fares, { a: 1300 });
});

test('two passengers sharing a commuter the whole way pay 110% together', () => {
  const fares = splitFares({
    driverMode: 'commute',
    passengers: [{ id: 'a', startKm: 0, endKm: 10, usual: 2000 }, { id: 'b', startKm: 0, endKm: 10, usual: 2000 }],
  });
  assert.deepEqual(fares, { a: 1100, b: 1100 });
});

test('with a go-anywhere driver, sharers split the usual fare so the total equals a solo fare', () => {
  const fares = splitFares({
    driverMode: 'anywhere',
    passengers: [
      { id: 'a', startKm: 0, endKm: 10, usual: 3000 },
      { id: 'b', startKm: 0, endKm: 10, usual: 3000 },
      { id: 'c', startKm: 0, endKm: 10, usual: 3000 },
    ],
  });
  assert.deepEqual(fares, { a: 1000, b: 1000, c: 1000 });
});

test('overlapping rides: each stretch is split between whoever is in the car', () => {
  // A rides 0-10 km, B joins at 5 km and rides to 15 km. Usual fare 200 per km for both.
  const fares = splitFares({
    driverMode: 'commute',
    passengers: [{ id: 'a', startKm: 0, endKm: 10, usual: 2000 }, { id: 'b', startKm: 5, endKm: 15, usual: 2000 }],
  });
  // A: 0-5 alone (1000 x 0.65) + 5-10 shared (1000 x 1.1 / 2) = 650 + 550
  // B: 5-10 shared (550) + 10-15 alone (650)
  assert.deepEqual(fares, { a: 1200, b: 1200 });
});

test('sharing never costs more than riding alone', () => {
  for (const driverMode of ['commute', 'anywhere']) {
    const solo = splitFares({ driverMode, passengers: [{ id: 'a', startKm: 0, endKm: 8, usual: 1600 }] }).a;
    const shared = splitFares({
      driverMode,
      passengers: [{ id: 'a', startKm: 0, endKm: 8, usual: 1600 }, { id: 'b', startKm: 2, endKm: 6, usual: 800 }],
    }).a;
    assert.ok(shared < solo, `${driverMode}: ${shared} < ${solo}`);
  }
});

test('a booking for two seats pays for two', () => {
  const fares = splitFares({
    driverMode: 'anywhere',
    passengers: [{ id: 'pair', startKm: 0, endKm: 10, usual: 3000, seats: 2 }, { id: 'one', startKm: 0, endKm: 10, usual: 3000 }],
  });
  assert.deepEqual(fares, { pair: 2000, one: 1000 });
});

test('the price rules match what Kingsley set', () => {
  assert.ok(PRICE_RULES.commuteSoloShare >= 0.6 && PRICE_RULES.commuteSoloShare <= 0.7);
  assert.ok(PRICE_RULES.commuteSharedTotal >= 1);
  assert.equal(PRICE_RULES.anywhereSharedTotal, 1);
});

test('trimRoute keeps only the part of the route ahead of the driver', async () => {
  const { trimRoute } = await import('../src/index.js');
  const bent = [at(0), at(5), at(5, 5)];
  const halfway = trimRoute(bent, at(3, 0.2));
  assert.equal(halfway.route.length, 3);
  assert.ok(Math.abs(halfway.route[0].lng - at(3).lng) < 1e-6);
  assert.ok(Math.abs(halfway.offRouteKm - 0.2) < 0.02);
  const pastBend = trimRoute(bent, at(5, 2));
  assert.equal(pastBend.route.length, 2);
  assert.ok(Math.abs(routeLengthKm(pastBend.route) - 3) < 0.05);
  const lost = trimRoute(bent, at(1, 3));
  assert.ok(lost.offRouteKm > 2.9);
});
