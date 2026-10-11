import { Router } from 'express';
import { isValidPoint } from '@pick/shared';
import { requireAuth } from '../auth/middleware.js';

export function placesRouter({ tokens, geocoder }) {
  const router = Router();

  // GET /places/search?q=Osu&lat=..&lng=.. -> places in the signed-in user's country, nearest first
  router.get('/search', requireAuth(tokens), async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2 || q.length > 100) return res.status(400).json({ error: 'search for 2 to 100 characters' });
    const near = req.query.lat !== undefined ? { lat: Number(req.query.lat), lng: Number(req.query.lng) } : null;
    if (near && !isValidPoint(near)) return res.status(400).json({ error: 'lat and lng must be numbers' });
    try {
      res.json({ places: await geocoder.search(q, { country: req.user.country, near }) });
    } catch (err) {
      console.error('places', err.message);
      res.status(502).json({ error: 'Address search is unavailable right now' });
    }
  });

  return router;
}
