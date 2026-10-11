import { Router } from 'express';
import { parseMarketPhone } from '@pick/shared';
import { OtpError } from '../auth/otp.js';
import { requireAuth } from '../auth/middleware.js';

const SIGNUP_ROLES = ['rider', 'driver'];

export function authRouter({ otp, users, tokens }) {
  const router = Router();

  const otpErrorStatus = { rate_limited: 429, invalid_code: 401 };
  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof OtpError) return res.status(otpErrorStatus[err.code]).json({ error: err.message });
      next(err);
    }
  };

  // POST /auth/code { phone } -> texts a 6-digit code
  router.post('/code', handle(async (req, res) => {
    const parsed = parseMarketPhone(req.body?.phone);
    if (!parsed) return res.status(400).json({ error: 'Enter a Ghana (+233) or Germany (+49) mobile number' });
    await otp.request(parsed.phone);
    res.status(204).end();
  }));

  // POST /auth/verify { phone, code, role?, name? } -> { token, user }
  // New users must pick a role; existing users just sign in.
  router.post('/verify', handle(async (req, res) => {
    const parsed = parseMarketPhone(req.body?.phone);
    if (!parsed) return res.status(400).json({ error: 'Enter a Ghana (+233) or Germany (+49) mobile number' });

    const existing = await users.findByPhone(parsed.phone);
    const { code, role, name } = req.body;
    if (!existing && !SIGNUP_ROLES.includes(role)) {
      return res.status(400).json({ error: 'role must be "rider" or "driver" for new accounts' });
    }

    await otp.verify(parsed.phone, code);
    const user = existing ?? (await users.create({ ...parsed, role, name }));
    res.json({ token: tokens.sign(user), user, isNew: !existing });
  }));

  router.get('/me', requireAuth(tokens), handle(async (req, res) => {
    const user = await users.findById(req.user.id);
    if (!user) return res.status(401).json({ error: 'sign in required' });
    res.json({ user });
  }));

  return router;
}
