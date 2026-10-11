import { Router } from 'express';
import { estimateFare, getMarket, isValidPoint } from '@pick/shared';

export const tripsRouter = Router();

// POST /trips/estimate { country: 'GH' | 'DE', pickup: {lat,lng}, dropoff: {lat,lng} }
tripsRouter.post('/estimate', (req, res) => {
  const { country, pickup, dropoff } = req.body ?? {};
  const market = getMarket(country);
  if (!market) return res.status(400).json({ error: 'country must be "GH" or "DE"' });
  if (!isValidPoint(pickup) || !isValidPoint(dropoff)) {
    return res.status(400).json({ error: 'pickup and dropoff must be { lat, lng }' });
  }
  res.json({ ...estimateFare(pickup, dropoff, market.pricing), currency: market.currency });
});
