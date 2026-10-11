import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { tripsRouter } from './routes/trips.js';
import { driversRouter } from './routes/drivers.js';

/** deps: { otp, users, tokens } — see server.js for the real ones, test/helpers.js for fakes. */
export function createApp({ corsOrigin = '*', deps }) {
  const app = express();
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/auth', authRouter(deps));
  app.use('/trips', tripsRouter);
  app.use('/drivers', driversRouter);

  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });
  return app;
}
