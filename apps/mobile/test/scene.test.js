import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driverScene, riderScene } from '../src/map/scene.js';
import { mapHtml } from '../src/map/mapHtml.js';

const pickup = { lat: 5.55, lng: -0.18 };
const dropoff = { lat: 5.62, lng: -0.1 };
const alight = { lat: 5.6, lng: -0.12 };
const car = { lat: 5.54, lng: -0.19 };

test('the rider sees pickup and drop-off, and the car once a driver is coming', () => {
  const waiting = riderScene({ status: 'requested', pickup, dropoff }, car);
  assert.deepEqual(waiting.markers.map((m) => m.kind), ['pickup', 'dropoff']);
  const coming = riderScene({ status: 'accepted', pickup, dropoff }, car);
  assert.deepEqual(coming.markers.find((m) => m.kind === 'car'), { id: 'car', kind: 'car', ...car });
  assert.notEqual(coming.fitKey, waiting.fitKey); // the map re-centres when the car appears...
  const moved = riderScene({ status: 'accepted', pickup, dropoff }, { lat: 5.545, lng: -0.185 });
  assert.equal(moved.fitKey, coming.fitKey); // ...but not every time it moves
  assert.equal(riderScene({ status: 'accepted', pickup, dropoff }, null).markers.length, 2);
});

test('a partway ride ends where the driver turns off', () => {
  const s = riderScene({ status: 'in_progress', pickup, dropoff, alight }, car);
  assert.deepEqual(s.markers.find((m) => m.id === 'dropoff'), { id: 'dropoff', kind: 'dropoff', ...alight });
});

test('the driver sees each passenger\'s next stop and a commuter\'s route', () => {
  const trips = [
    { id: 't1', status: 'accepted', pickup, dropoff },
    { id: 't2', status: 'in_progress', pickup, dropoff, alight },
  ];
  const s = driverScene({ me: car, trips, route: [car, alight, dropoff] });
  assert.deepEqual(s.markers.map((m) => [m.id, m.kind]), [['me', 'car'], ['t1:pickup', 'pickup'], ['t2:dropoff', 'dropoff']]);
  assert.deepEqual(s.markers[2], { id: 't2:dropoff', kind: 'dropoff', ...alight });
  assert.equal(s.line.length, 3);
  assert.equal(driverScene({ me: null, trips: [], route: [car] }).line, null); // one point is no line
  assert.deepEqual(driverScene({ me: null, trips: [{ id: 'x', status: 'accepted', pickup: null }] }).markers, []);
});

test('the map page loads Leaflet and the tile server', () => {
  const html = mapHtml({ tiles: 'https://tiles.example/{z}/{x}/{y}.png', attribution: '&copy; Example' });
  assert.match(html, /leaflet@1\.9\.4\/dist\/leaflet\.js/);
  assert.match(html, /"https:\/\/tiles\.example\/\{z\}\/\{x\}\/\{y\}\.png"/);
  assert.match(html, /window\.pickUpdate = function/);
});
