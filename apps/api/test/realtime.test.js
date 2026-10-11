import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as connect } from 'socket.io-client';
import { attachRealtime } from '../src/realtime/socket.js';
import { createTokens } from '../src/auth/tokens.js';

const tokens = createTokens({ secret: 'test-secret', expiresIn: '1h' });

async function withServer(fn) {
  const server = http.createServer();
  const io = attachRealtime(server, { corsOrigin: '*', tokens });
  await new Promise((r) => server.listen(0, r));
  try {
    await fn(`http://localhost:${server.address().port}`);
  } finally {
    io.close();
  }
}

function connectResult(url, auth) {
  return new Promise((resolve) => {
    const socket = connect(url, { auth, reconnection: false, transports: ['websocket'] });
    socket.on('connect', () => { socket.close(); resolve('connected'); });
    socket.on('connect_error', (err) => { socket.close(); resolve(err.message); });
  });
}

test('live channel refuses connections without a valid token', async () => {
  await withServer(async (url) => {
    assert.equal(await connectResult(url, {}), 'sign in required');
    assert.equal(await connectResult(url, { token: 'nonsense' }), 'sign in required');
  });
});

test('live channel accepts a signed-in user', async () => {
  await withServer(async (url) => {
    const token = tokens.sign({ id: 'u1', role: 'driver', country: 'GH' });
    assert.equal(await connectResult(url, { token }), 'connected');
  });
});
