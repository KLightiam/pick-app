import { Router } from 'express';
import { isValidPoint } from '@pick/shared';
import { requireAuth, requireRole } from '../auth/middleware.js';

export function driversRouter({ tokens, drivers }) {
  const router = Router();

  // GET /drivers/nearby?lat=..&lng=..&radiusKm=5 -> cars to show on the rider's map
  router.get('/nearby', async (req, res, next) => {
    const point = { lat: Number(req.query.lat), lng: Number(req.query.lng) };
    const radiusKm = Math.min(Number(req.query.radiusKm ?? 5), 25);
    if (!isValidPoint(point) || !(radiusKm > 0)) {
      return res.status(400).json({ error: 'lat, lng and a positive radiusKm are required' });
    }
    try {
      res.json({ drivers: await drivers.nearby(point, { radiusKm, limit: 10 }) });
    } catch (err) {
      next(err);
    }
  });

  // POST /drivers/me/status { online: boolean, location?: {lat,lng} } -> start or stop taking rides
  router.post('/me/status', requireAuth(tokens), requireRole('driver'), async (req, res, next) => {
    const { online, location } = req.body ?? {};
    if (typeof online !== 'boolean') return res.status(400).json({ error: 'online must be true or false' });
    if (online && !isValidPoint(location)) {
      return res.status(400).json({ error: 'location { lat, lng } is required to go online' });
    }
    try {
      const driver = await drivers.findById(req.user.id);
      if (!driver) return res.status(404).json({ error: 'driver profile not found' });
      if (online && !driver.approved) {
        return res.status(403).json({ error: 'Your driver account is waiting for approval' });
      }
      await drivers.setStatus(req.user.id, { online, location: online ? location : undefined });
      res.json({ online });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
