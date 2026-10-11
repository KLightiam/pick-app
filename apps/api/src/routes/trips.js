import { Router } from 'express';
import { estimateFare, getMarket, isValidPoint } from '@pick/shared';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { DispatchError } from '../trips/dispatch.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optionalText = (v) => v === undefined || v === null || (typeof v === 'string' && v.length <= 300);

export function tripsRouter({ tokens, trips, dispatch }) {
  const router = Router();
  const auth = requireAuth(tokens);

  const handle = (fn) => async (req, res, next) => {
    if (req.params.id !== undefined && !UUID.test(req.params.id)) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof DispatchError) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };

  // POST /trips/estimate { country: 'GH' | 'DE', pickup: {lat,lng}, dropoff: {lat,lng} }
  router.post('/estimate', (req, res) => {
    const { country, pickup, dropoff } = req.body ?? {};
    const market = getMarket(country);
    if (!market) return res.status(400).json({ error: 'country must be "GH" or "DE"' });
    if (!isValidPoint(pickup) || !isValidPoint(dropoff)) {
      return res.status(400).json({ error: 'pickup and dropoff must be { lat, lng }' });
    }
    res.json({ ...estimateFare(pickup, dropoff, market.pricing), currency: market.currency });
  });

  // POST /trips { pickup, dropoff, pickupAddress?, dropoffAddress? } -> offers the ride to nearby drivers
  router.post('/', auth, requireRole('rider'), handle(async (req, res) => {
    const { pickup, dropoff, pickupAddress, dropoffAddress } = req.body ?? {};
    if (!isValidPoint(pickup) || !isValidPoint(dropoff)) {
      return res.status(400).json({ error: 'pickup and dropoff must be { lat, lng }' });
    }
    if (!optionalText(pickupAddress) || !optionalText(dropoffAddress)) {
      return res.status(400).json({ error: 'addresses must be text up to 300 characters' });
    }
    const result = await dispatch.requestRide(req.user, { pickup, dropoff, pickupAddress, dropoffAddress });
    res.status(201).json(result);
  }));

  // GET /trips/:id -> only the trip's rider and driver can see it
  router.get('/:id', auth, handle(async (req, res) => {
    const trip = await trips.findById(req.params.id);
    if (!trip || (trip.riderId !== req.user.id && trip.driverId !== req.user.id)) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    res.json({ trip });
  }));

  router.post('/:id/accept', auth, requireRole('driver'), handle(async (req, res) => {
    res.json(await dispatch.accept(req.user, req.params.id));
  }));

  router.post('/:id/cancel', auth, handle(async (req, res) => {
    const reason = req.body?.reason;
    if (!optionalText(reason)) return res.status(400).json({ error: 'reason must be text up to 300 characters' });
    res.json({ trip: await dispatch.cancel(req.user, req.params.id, reason) });
  }));

  return router;
}
