import { Router } from 'express';
import { isValidPoint } from '@pick/shared';
import { requireAuth, requireRole } from '../auth/middleware.js';

export function driversRouter({ tokens, drivers, routing }) {
  const router = Router();

  // GET /drivers/nearby?lat=..&lng=..&radiusKm=5 -> cars with free seats to show on the rider's map
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

  const driverAuth = [requireAuth(tokens), requireRole('driver')];
  const withDriver = (fn) => async (req, res, next) => {
    try {
      const driver = await drivers.findById(req.user.id);
      if (!driver) return res.status(404).json({ error: 'driver profile not found' });
      await fn(req, res, driver);
    } catch (err) {
      next(err);
    }
  };

  router.get('/me', ...driverAuth, withDriver(async (_req, res, driver) => {
    res.json({ driver });
  }));

  // PUT /drivers/me/vehicle { vehicleMake?, vehiclePlate?, seats } -> seats = passenger seats in the car
  router.put('/me/vehicle', ...driverAuth, withDriver(async (req, res) => {
    const { vehicleMake, vehiclePlate, seats } = req.body ?? {};
    if (!Number.isInteger(seats) || seats < 1 || seats > 8) {
      return res.status(400).json({ error: 'seats must be a whole number from 1 to 8' });
    }
    const text = (v) => v === undefined || v === null || (typeof v === 'string' && v.length <= 60);
    if (!text(vehicleMake) || !text(vehiclePlate)) return res.status(400).json({ error: 'vehicle details are too long' });
    await drivers.updateVehicle(req.user.id, { vehicleMake, vehiclePlate, seats });
    res.json({ driver: await drivers.findById(req.user.id) });
  }));

  // POST /drivers/me/status
  //   go online:  { online: true, location, mode: 'commute' | 'anywhere', destination?, destinationAddress?, seatsOffered? }
  //   go offline: { online: false }
  // Commuters set where they're heading; seatsOffered is how many seats passengers can share (1 = one booking at a time).
  router.post('/me/status', ...driverAuth, withDriver(async (req, res, driver) => {
    const { online, location, mode = 'anywhere', destination, destinationAddress, seatsOffered = 1 } = req.body ?? {};
    if (typeof online !== 'boolean') return res.status(400).json({ error: 'online must be true or false' });
    if (!online) {
      await drivers.setStatus(req.user.id, { online: false });
      return res.json({ online: false });
    }
    if (!isValidPoint(location)) return res.status(400).json({ error: 'location { lat, lng } is required to go online' });
    if (!['commute', 'anywhere'].includes(mode)) return res.status(400).json({ error: 'mode must be "commute" or "anywhere"' });
    if (mode === 'commute' && !isValidPoint(destination)) {
      return res.status(400).json({ error: 'commuters need a destination { lat, lng }' });
    }
    if (destinationAddress !== undefined && !(typeof destinationAddress === 'string' && destinationAddress.length <= 300)) {
      return res.status(400).json({ error: 'destinationAddress must be text up to 300 characters' });
    }
    if (!Number.isInteger(seatsOffered) || seatsOffered < 1 || seatsOffered > driver.seats) {
      return res.status(400).json({ error: `seatsOffered must be from 1 to ${driver.seats}, the seats in your car` });
    }
    if (!driver.approved) return res.status(403).json({ error: 'Your driver account is waiting for approval' });

    const route = mode === 'commute' ? await routing.route(location, destination) : null;
    await drivers.setStatus(req.user.id, {
      online: true, location, mode, destination, destinationAddress, seatsOffered, route: route?.points,
    });
    res.json({
      online: true, mode, seatsOffered,
      route: route && { points: route.points, distanceKm: route.distanceKm, durationMin: route.durationMin, source: route.source },
    });
  }));

  return router;
}
