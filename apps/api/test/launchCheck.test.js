import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchProblems, parseOrigins } from '../src/launchCheck.js';

const ready = {
  JWT_SECRET: 'a'.repeat(64),
  DATABASE_URL: 'postgres://pick@db/pick',
  SMS_PROVIDER: 'twilio',
  TWILIO_ACCOUNT_SID: 'AC1',
  TWILIO_AUTH_TOKEN: 'tok',
  PUBLIC_URL: 'https://api.pick.example',
  PAYSTACK_SECRET_KEY: 'sk_live_1',
  STRIPE_SECRET_KEY: 'sk_live_2',
  STRIPE_WEBHOOK_SECRET: 'whsec_1',
  S3_BUCKET: 'pick-docs',
  AWS_ACCESS_KEY_ID: 'k',
  AWS_SECRET_ACCESS_KEY: 's',
  CORS_ORIGIN: 'https://pick.example, https://admin.pick.example/',
  OSRM_URL: 'https://osrm.pick.example',
  GEOCODER_URL: 'https://photon.pick.example',
};

test('a fully set up production environment has nothing to fix', () => {
  assert.deepEqual(launchProblems(ready), { errors: [], warnings: [] });
});

test('the development defaults are refused for production', () => {
  const { errors, warnings } = launchProblems({ JWT_SECRET: 'change-me' });
  assert.deepEqual(errors.map((e) => e.split(' ')[0]), [
    'JWT_SECRET', 'DATABASE_URL', 'SMS_PROVIDER', 'PUBLIC_URL', 'Payments', 'S3_BUCKET',
  ]);
  assert.equal(warnings.length, 3); // open CORS, public OSRM, public Photon
});

test('half-done settings are caught', () => {
  const { errors, warnings } = launchProblems({
    ...ready, TWILIO_AUTH_TOKEN: '', PUBLIC_URL: 'http://api.pick.example', STRIPE_SECRET_KEY: 'sk_test_x',
    ROUTING_PROVIDER: 'straight', PUSH_NOTIFICATIONS: 'off',
  });
  assert.deepEqual(errors, [
    'Twilio needs TWILIO_AUTH_TOKEN',
    "PUBLIC_URL must be the API's https:// address (payment pages and shared trip links use it)",
    'ROUTING_PROVIDER=straight is for testing; use osrm',
  ]);
  assert.equal(warnings.length, 2); // test key, pushes off
});

test('CORS_ORIGIN takes one or several origins', () => {
  assert.equal(parseOrigins(undefined), '*');
  assert.equal(parseOrigins('*'), '*');
  assert.equal(parseOrigins('http://localhost:5173'), 'http://localhost:5173');
  assert.deepEqual(parseOrigins('http://localhost:5173, http://localhost:8081/'), ['http://localhost:5173', 'http://localhost:8081']);
});
