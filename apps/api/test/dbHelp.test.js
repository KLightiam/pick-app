import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainDbError, waitForDb } from '../src/db/help.js';

const URL = 'postgres://pick:pick@localhost:5432/pick';
const fail = (code, message = 'boom') => Object.assign(new Error(message), { code });

test('setup errors are explained in plain words', () => {
  assert.match(explainDbError(fail('ECONNREFUSED'), URL), /^Can't reach the database at localhost:5432\. Make sure Docker Desktop is running/);
  assert.match(explainDbError(fail('28P01'), URL), /another PostgreSQL on this computer/);
  assert.match(explainDbError(fail('3D000'), URL), /no database with that name/);
  assert.match(explainDbError(fail('58P01', 'could not open extension control file "postgis.control"'), URL), /doesn't have PostGIS/);
  assert.equal(explainDbError(fail('42601', 'syntax error'), URL), null);
});

test('waits for a database that is still starting', async () => {
  const errors = [fail('ECONNREFUSED'), fail('57P03')];
  const pool = { query: async () => { if (errors.length) throw errors.shift(); } };
  const logs = [];
  await waitForDb(pool, { intervalMs: 1, log: (m) => logs.push(m) });
  assert.deepEqual(logs, ['Waiting for the database to start…']);
});

test('gives up waiting after the timeout, and at once on other errors', async () => {
  const down = { query: async () => { throw fail('ECONNREFUSED'); } };
  await assert.rejects(waitForDb(down, { timeoutMs: 20, intervalMs: 5, log: () => {} }), { code: 'ECONNREFUSED' });
  let calls = 0;
  const wrongPassword = { query: async () => { calls++; throw fail('28P01'); } };
  await assert.rejects(waitForDb(wrongPassword, { log: () => {} }), { code: '28P01' });
  assert.equal(calls, 1);
});
