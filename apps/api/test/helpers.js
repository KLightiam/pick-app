import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { createOtpService } from '../src/auth/otp.js';
import { createTokens } from '../src/auth/tokens.js';

export function memoryOtpStore() {
  const rows = [];
  let nextId = 1;
  return {
    rows,
    async countSince(phone, since) {
      return rows.filter((r) => r.phone === phone && r.createdAt > since).length;
    },
    async create({ phone, codeHash, expiresAt }) {
      rows.push({ id: nextId++, phone, codeHash, expiresAt, attempts: 0, usedAt: null, createdAt: new Date() });
    },
    async latestActive(phone, at) {
      return rows.filter((r) => r.phone === phone && !r.usedAt && r.expiresAt > at).at(-1) ?? null;
    },
    async addAttempt(id) {
      rows.find((r) => r.id === id).attempts++;
    },
    async markUsed(id, at) {
      rows.find((r) => r.id === id).usedAt = at;
    },
  };
}

export function memoryUsersRepo() {
  const users = [];
  return {
    users,
    async findByPhone(phone) {
      return users.find((u) => u.phone === phone) ?? null;
    },
    async findById(id) {
      return users.find((u) => u.id === id) ?? null;
    },
    async create({ phone, country, role, name }) {
      const user = { id: randomUUID(), phone, country, role, name: name ?? null };
      users.push(user);
      return user;
    },
  };
}

/** Records texts instead of sending them; lastCode(phone) reads the code back. */
export function fakeSms() {
  const sent = [];
  return {
    sent,
    async send(to, body) {
      sent.push({ to, body });
    },
    lastCode(to) {
      return sent.filter((m) => m.to === to).at(-1)?.body.match(/\d{6}/)[0];
    },
  };
}

export function testApp({ now } = {}) {
  const sms = fakeSms();
  const store = memoryOtpStore();
  const users = memoryUsersRepo();
  const tokens = createTokens({ secret: 'test-secret', expiresIn: '1h' });
  const otp = createOtpService({ store, sms, secret: 'test-secret', now });
  const app = createApp({ deps: { otp, users, tokens } });
  return { app, sms, store, users, tokens };
}
