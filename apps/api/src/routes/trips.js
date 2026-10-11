import { Router } from 'express';
import { estimateFare, getMarket, isValidPoint } from '@pick/shared';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { DispatchError } from '../trips/dispatch.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optionalText = (v) => v === undefined || v === null || (typeof v === 'string' && v.length <= 300);
const RIDE_TYPES = ['solo', 'shared'];

/** Validates a ride request body. Returns { error } or { request }. */
function parseRideRequest(body = {}, { needDriver }) {
  const { pickup, dropoff, pickupAddress, dropoffAddress, driverId, rideType = 'solo', seats = 1 } = body;
  if (!isValidPoint(pickup) || !isValidPoint(dropoff)) return { error: 'pickup and dropoff must be { lat, lng }' };
  if (!optionalText(pickupAddress) || !optionalText(dropoffAddress)) {
    return { error: 'addresses must be text up to 300 characters' };
  }
  if (!RIDE_TYPES.includes(rideType)) return { error: 'rideType must be "solo" or "shared"' };
  if (!Number.isInteger(seats) || seats < 1 || seats > 8) return { error: 'seats must be a whole number from 1 to 8' };
  if (needDriver && !(typeof driverId === 'string' && UUID.test(driverId))) return { error: 'choose a driver' };
  return { request: { pickup, dropoff, pickupAddress, dropoffAddress, driverId, rideType, seats } };
}

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

  // POST /trips/options { pickup, dropoff, rideType?, seats? } -> drivers who can take the ride, best first
  router.post('/options', auth, requireRole('rider'), handle(async (req, res) => {
    const { error, request } = parseRideRequest(req.body, { needDriver: false });
    if (error) return res.status(400).json({ error });
    res.json({ options: await dispatch.options(req.user, request) });
  }));

  // POST /trips { driverId, pickup, dropoff, rideType?, seats?, pickupAddress?, dropoffAddress? }
  // -> sends the request to the chosen driver
  router.post('/', auth, requireRole('rider'), handle(async (req, res) => {
    const { error, request } = parseRideRequest(req.body, { needDriver: true });
    if (error) return res.status(400).json({ error });
    res.status(201).json(await dispatch.requestRide(req.user, request));
  }));

  // GET /trips/active -> the rider's current trip, or the driver's current passengers (for when the app reopens)
  router.get('/active', auth, handle(async (req, res) => {
    if (req.user.role === 'driver') return res.json({ trips: await trips.findActiveForDriver(req.user.id) });
    const trip = await trips.findActiveForRider(req.user.id);
    res.json({ trips: trip ? [trip] : [] });
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

  // Driver progress through a trip
  router.post('/:id/arrived', auth, requireRole('driver'), handle(async (req, res) => {
    res.json({ trip: await dispatch.advance(req.user, req.params.id, 'arrived') });
  }));
  router.post('/:id/start', auth, requireRole('driver'), handle(async (req, res) => {
    res.json({ trip: await dispatch.advance(req.user, req.params.id, 'in_progress') });
  }));
  router.post('/:id/complete', auth, requireRole('driver'), handle(async (req, res) => {
    res.json(await dispatch.complete(req.user, req.params.id));
  }));

  router.post('/:id/cancel', auth, handle(async (req, res) => {
    const reason = req.body?.reason;
    if (!optionalText(reason)) return res.status(400).json({ error: 'reason must be text up to 300 characters' });
    res.json({ trip: await dispatch.cancel(req.user, req.params.id, reason) });
  }));

  return router;
}
