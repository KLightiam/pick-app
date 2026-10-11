import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { tripsRouter } from './routes/trips.js';
import { driversRouter } from './routes/drivers.js';
import { placesRouter } from './routes/places.js';
import { paymentsRouter } from './routes/payments.js';
import { adminRouter } from './routes/admin.js';

/**
 * deps: { otp, users, tokens, drivers, trips, dispatch, routing, geocoder, payments, admin, documents, testCheckout? }
 * See server.js for the real ones and test/helpers.js for in-memory fakes.
 */
export function createApp({ corsOrigin = '*', deps }) {
  const app = express();
  app.use(cors({ origin: corsOrigin }));
  // Webhooks are verified against the exact bytes the provider sent.
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/auth', authRouter(deps));
  app.use('/trips', tripsRouter(deps));
  app.use('/drivers', driversRouter(deps));
  app.use('/places', placesRouter(deps));
  app.use('/payments', paymentsRouter(deps));
  app.use('/admin', adminRouter(deps));

  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  app.use((err, _req, res, _next) => {
    // Request bodies that couldn't be read: bad JSON, or an upload over the size limit.
    if (err.type && err.status >= 400 && err.status < 500) {
      return res.status(err.status).json({ error: err.status === 413 ? 'The upload is too big' : 'The request body is invalid' });
    }
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });
  return app;
}
