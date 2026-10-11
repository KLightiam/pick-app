import { Router } from 'express';
import { estimateFare, getMarket, isValidPoint } from '@pick/shared';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { DispatchError } from '../trips/dispatch.js';
import { PaymentError } from '../payments/service.js';
import { SafetyError } from '../safety/service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optionalText = (v) => v === undefined || v === null || (typeof v === 'string' && v.length <= 300);
const RIDE_TYPES = ['solo', 'shared'];
const PAYMENT_METHODS = ['cash', 'app'];

/** Validates a ride request body. Returns { error } or { request }. */
function parseRideRequest(body = {}, { needDriver }) {
  const {
    pickup, dropoff, pickupAddress, dropoffAddress, driverId, rideType = 'solo', seats = 1, paymentMethod = 'cash',
  } = body;
  if (!isValidPoint(pickup) || !isValidPoint(dropoff)) return { error: 'pickup and dropoff must be { lat, lng }' };
  if (!optionalText(pickupAddress) || !optionalText(dropoffAddress)) {
    return { error: 'addresses must be text up to 300 characters' };
  }
  if (!RIDE_TYPES.includes(rideType)) return { error: 'rideType must be "solo" or "shared"' };
  if (!Number.isInteger(seats) || seats < 1 || seats > 8) return { error: 'seats must be a whole number from 1 to 8' };
  if (!PAYMENT_METHODS.includes(paymentMethod)) return { error: 'paymentMethod must be "cash" or "app"' };
  if (needDriver && !(typeof driverId === 'string' && UUID.test(driverId))) return { error: 'choose a driver' };
  return { request: { pickup, dropoff, pickupAddress, dropoffAddress, driverId, rideType, seats, paymentMethod } };
}

export function tripsRouter({ tokens, trips, drivers, dispatch, payments, safety }) {
  const router = Router();
  const auth = requireAuth(tokens);

  const handle = (fn) => async (req, res, next) => {
    if (req.params.id !== undefined && !UUID.test(req.params.id)) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof DispatchError || err instanceof PaymentError || err instanceof SafetyError) return res.status(err.status).json({ error: err.message });
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

  // POST /trips { driverId, pickup, dropoff, rideType?, seats?, paymentMethod?, pickupAddress?, dropoffAddress? }
  // paymentMethod is 'cash' (the default) or 'app' (card, or mobile money in Ghana, paid after drop-off)
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

  // GET /trips/offers -> { offers: [{ trip, expiresAt }] }: ride requests still waiting for this driver to accept,
  // for when the app opens from a push notification
  router.get('/offers', auth, requireRole('driver'), handle(async (req, res) => {
    res.json({ offers: await dispatch.openOffers(req.user) });
  }));

  // GET /trips/:id -> only the trip's rider and driver can see it
  router.get('/:id', auth, handle(async (req, res) => {
    const trip = await trips.findById(req.params.id);
    if (!trip || (trip.riderId !== req.user.id && trip.driverId !== req.user.id)) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    // The rider also gets who's driving, e.g. when the app reopens after the driver accepted
    const profile = trip.riderId === req.user.id && trip.driverId ? await drivers.findById(trip.driverId) : null;
    const driver = profile && {
      id: trip.driverId, name: profile.name ?? null, vehicleMake: profile.vehicleMake ?? null,
      vehiclePlate: profile.vehiclePlate ?? null, rating: profile.rating ?? null,
    };
    res.json({ trip, ...(driver && { driver }) });
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

  // GET /trips/:id/payment -> { payment } once the trip is complete (null before)
  router.get('/:id/payment', auth, handle(async (req, res) => {
    const trip = await trips.findById(req.params.id);
    if (!trip || (trip.riderId !== req.user.id && trip.driverId !== req.user.id)) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    const payment = await payments.forTrip(trip.id);
    res.json({ payment: trip.riderId === req.user.id ? await payments.refresh(payment) : payment });
  }));

  // POST /trips/:id/pay -> { checkoutUrl, payment }: the Paystack or Stripe page where the rider pays
  router.post('/:id/pay', auth, requireRole('rider'), handle(async (req, res) => {
    res.json(await payments.startCheckout(req.user, req.params.id));
  }));

  // GET /trips/:id/rating -> { rating }: the one this person gave, or null
  router.get('/:id/rating', auth, handle(async (req, res) => {
    res.json({ rating: await safety.myRating(req.user, req.params.id) });
  }));

  // POST /trips/:id/rating { stars: 1-5, comment? } -> the rider rates the driver, or the driver the rider
  router.post('/:id/rating', auth, handle(async (req, res) => {
    const { stars, comment } = req.body ?? {};
    res.status(201).json({ rating: await safety.rate(req.user, req.params.id, { stars, comment }) });
  }));

  // POST /trips/:id/share -> { url }: a link the rider sends to someone so they can follow the trip
  router.post('/:id/share', auth, requireRole('rider'), handle(async (req, res) => {
    res.status(201).json(await safety.share(req.user, req.params.id));
  }));

  // POST /trips/:id/reports { category, details? } -> a problem with the trip, for admins to follow up
  router.post('/:id/reports', auth, handle(async (req, res) => {
    const { category, details } = req.body ?? {};
    res.status(201).json({ report: await safety.report(req.user, req.params.id, { category, details }) });
  }));

  router.post('/:id/cancel', auth, handle(async (req, res) => {
    const reason = req.body?.reason;
    if (!optionalText(reason)) return res.status(400).json({ error: 'reason must be text up to 300 characters' });
    res.json({ trip: await dispatch.cancel(req.user, req.params.id, reason) });
  }));

  return router;
}
