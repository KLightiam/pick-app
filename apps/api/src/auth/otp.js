import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

const TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 5;

export class OtpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // 'rate_limited' | 'invalid_code'
  }
}

/**
 * One-time sign-in codes sent by SMS. Codes are stored only as HMACs.
 * `store` persists codes (Postgres in the app, in-memory in tests).
 */
export function createOtpService({ store, sms, secret, now = () => new Date() }) {
  const hash = (phone, code) => createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex');

  return {
    async request(phone) {
      const since = new Date(now().getTime() - 60 * 60 * 1000);
      if ((await store.countSince(phone, since)) >= MAX_SENDS_PER_HOUR) {
        throw new OtpError('rate_limited', 'Too many codes requested. Try again later.');
      }
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await store.create({ phone, codeHash: hash(phone, code), expiresAt: new Date(now().getTime() + TTL_MS) });
      await sms.send(phone, `Your Pick code is ${code}. It expires in 5 minutes.`);
    },

    async verify(phone, code) {
      const entry = await store.latestActive(phone, now());
      if (!entry || entry.attempts >= MAX_ATTEMPTS) {
        throw new OtpError('invalid_code', 'Code is invalid or expired.');
      }
      const expected = Buffer.from(entry.codeHash, 'hex');
      const actual = Buffer.from(hash(phone, String(code ?? '')), 'hex');
      if (!timingSafeEqual(expected, actual)) {
        await store.addAttempt(entry.id);
        throw new OtpError('invalid_code', 'Code is invalid or expired.');
      }
      await store.markUsed(entry.id, now());
    },
  };
}
