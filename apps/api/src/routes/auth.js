import { Router } from 'express';
import { parseMarketPhone } from '@pick/shared';
import { OtpError } from '../auth/otp.js';
import { requireAuth } from '../auth/middleware.js';
import { isExpoPushToken } from '../push/expo.js';

const SIGNUP_ROLES = ['rider', 'driver'];

export function authRouter({ otp, users, tokens, pushTokens }) {
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

  // PUT /auth/push-token { token, platform: 'ios' | 'android' } -> this phone gets push notifications for this account
  router.put('/push-token', requireAuth(tokens), handle(async (req, res) => {
    const { token, platform } = req.body ?? {};
    if (!isExpoPushToken(token)) return res.status(400).json({ error: 'token must be an Expo push token' });
    if (!['ios', 'android'].includes(platform)) return res.status(400).json({ error: 'platform must be "ios" or "android"' });
    await pushTokens.save({ userId: req.user.id, token, platform });
    res.status(204).end();
  }));

  // DELETE /auth/push-token { token } -> on sign-out, so the next person on this phone doesn't get your notifications
  router.delete('/push-token', requireAuth(tokens), handle(async (req, res) => {
    const { token } = req.body ?? {};
    if (!isExpoPushToken(token)) return res.status(400).json({ error: 'token must be an Expo push token' });
    await pushTokens.remove(token, req.user.id);
    res.status(204).end();
  }));

  return router;
}
