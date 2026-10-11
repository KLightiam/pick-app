import { Router } from 'express';
import { estimateFare, isValidPoint } from '@pick/shared';

export const tripsRouter = Router();

// POST /trips/estimate { pickup: {lat,lng}, dropoff: {lat,lng} }
tripsRouter.post('/estimate', (req, res) => {
  const { pickup, dropoff } = req.body ?? {};
  if (!isValidPoint(pickup) || !isValidPoint(dropoff)) {
    return res.status(400).json({ error: 'pickup and dropoff must be { lat, lng }' });
  }
  res.json(estimateFare(pickup, dropoff));
});
