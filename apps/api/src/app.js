import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { tripsRouter } from './routes/trips.js';
import { driversRouter } from './routes/drivers.js';
import { placesRouter } from './routes/places.js';

/**
 * deps: { otp, users, tokens, drivers, trips, dispatch, routing, geocoder }
 * See server.js for the real ones and test/helpers.js for in-memory fakes.
 */
export function createApp({ corsOrigin = '*', deps }) {
  const app = express();
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/auth', authRouter(deps));
  app.use('/trips', tripsRouter(deps));
  app.use('/drivers', driversRouter(deps));
  app.use('/places', placesRouter(deps));

  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });
  return app;
}
