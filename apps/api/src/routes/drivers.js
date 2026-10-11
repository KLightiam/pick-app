import { Router } from 'express';
import { isValidPoint } from '@pick/shared';
import { db } from '../db/pool.js';

export const driversRouter = Router();

// GET /drivers/nearby?lat=..&lng=..&radiusKm=5
driversRouter.get('/nearby', async (req, res, next) => {
  const point = { lat: Number(req.query.lat), lng: Number(req.query.lng) };
  const radiusKm = Math.min(Number(req.query.radiusKm ?? 5), 25);
  if (!isValidPoint(point) || !(radiusKm > 0)) {
    return res.status(400).json({ error: 'lat, lng and a positive radiusKm are required' });
  }
  try {
    const { rows } = await db().query(
      `SELECT user_id AS "driverId",
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lng,
              ST_Distance(location, ST_MakePoint($2, $1)::geography) / 1000 AS "distanceKm"
         FROM drivers
        WHERE online AND approved
          AND location_at > now() - interval '2 minutes'
          AND ST_DWithin(location, ST_MakePoint($2, $1)::geography, $3 * 1000)
        ORDER BY "distanceKm"
        LIMIT 10`,
      [point.lat, point.lng, radiusKm],
    );
    res.json({ drivers: rows });
  } catch (err) {
    next(err);
  }
});
