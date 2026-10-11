import { Router } from 'express';
import express from 'express';
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, MARKETS, MOBILE_MONEY_NETWORKS, isValidPoint } from '@pick/shared';
import { DocumentError } from '../documents/service.js';
import { PayoutError } from '../payouts/service.js';
import { requireAuth, requireRole } from '../auth/middleware.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sends an uploaded document so browsers show it but never run it. */
export function sendFile(res, { bytes, contentType }) {
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    'Cache-Control': 'private, no-store',
  });
  res.send(bytes);
}

export function driversRouter({ tokens, drivers, routing, payments, payouts, documents }) {
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
      if (err instanceof DocumentError || err instanceof PayoutError) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };

  router.get('/me', ...driverAuth, withDriver(async (_req, res, driver) => {
    res.json({ driver });
  }));

  // GET /drivers/me/earnings?days=7 -> rides with what the driver earned, and their balance with Pick
  router.get('/me/earnings', ...driverAuth, withDriver(async (req, res) => {
    const days = Number(req.query.days ?? 7);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      return res.status(400).json({ error: 'days must be a whole number from 1 to 90' });
    }
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    res.json(await payments.earnings(req.user.id, { since }));
  }));

  // GET /drivers/me/payouts -> { account, schedule, payouts, networks }: where the driver is paid, how often, and past payouts
  router.get('/me/payouts', ...driverAuth, withDriver(async (req, res) => {
    const ghana = MARKETS[req.user.country].payout.method === 'mobile_money';
    res.json({
      account: await payouts.account(req.user.id),
      schedule: payouts.schedule(req.user.country),
      payouts: await payouts.history(req.user.id),
      networks: ghana ? MOBILE_MONEY_NETWORKS : [],
    });
  }));

  // PUT /drivers/me/payout-account
  //   Ghana:   { name, number, network: 'MTN' | 'VOD' | 'ATL' } -> { account }
  //   Germany: {} -> { account, onboardingUrl }: Stripe's page for identity and bank details, until the account is ready
  router.put('/me/payout-account', ...driverAuth, withDriver(async (req, res) => {
    res.json(await payouts.setup(req.user, req.body ?? {}));
  }));

  // GET /drivers/me/documents -> { documents: [{ kind, label, document }] }: what this country asks for, and the latest upload of each
  router.get('/me/documents', ...driverAuth, withDriver(async (req, res) => {
    res.json({ documents: await documents.checklistFor(req.user.id, req.user.country) });
  }));

  // PUT /drivers/me/documents/:kind with the file as the body (Content-Type image/jpeg, image/png, image/heic or application/pdf)
  router.put(
    '/me/documents/:kind',
    ...driverAuth,
    express.raw({ type: DOCUMENT_TYPES, limit: MAX_DOCUMENT_BYTES }),
    withDriver(async (req, res) => {
      const document = await documents.upload(req.user, {
        kind: req.params.kind, contentType: req.headers['content-type'], bytes: req.body,
      });
      res.status(201).json({ document });
    }),
  );

  // GET /drivers/me/documents/:id/file -> the driver's own upload
  router.get('/me/documents/:id/file', ...driverAuth, withDriver(async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Document not found' });
    sendFile(res, await documents.file(req.user, req.params.id));
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
