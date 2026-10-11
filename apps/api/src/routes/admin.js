import { Router } from 'express';
import { getMarket } from '@pick/shared';
import { requireAuth, requireRole } from '../auth/middleware.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRIP_STATUSES = ['requested', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled'];
const optionalText = (v, max) => v === undefined || v === null || (typeof v === 'string' && v.length <= max);

/** Everything under /admin is for admin accounts only (created with `pnpm --filter @pick/api make-admin`). */
export function adminRouter({ tokens, admin }) {
  const router = Router();
  router.use(requireAuth(tokens), requireRole('admin'));

  const handle = (fn) => async (req, res, next) => {
    const { country } = req.query;
    if (country !== undefined && !getMarket(country)) return res.status(400).json({ error: 'country must be "GH" or "DE"' });
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

  // GET /admin/overview?days=1&country= -> drivers, riders, trips and money for the period
  router.get('/overview', handle(async (req, res) => {
    const days = Number(req.query.days ?? 1);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return res.status(400).json({ error: 'days must be a whole number from 1 to 365' });
    }
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    res.json({ since: since.toISOString(), ...(await admin.overview({ since, country: req.query.country })) });
  }));

  // GET /admin/drivers?status=pending|approved|all&q=&country=
  router.get('/drivers', handle(async (req, res) => {
    const status = req.query.status ?? 'all';
    if (!['pending', 'approved', 'all'].includes(status)) {
      return res.status(400).json({ error: 'status must be pending, approved or all' });
    }
    if (!optionalText(req.query.q, 60)) return res.status(400).json({ error: 'search is too long' });
    res.json({ drivers: await admin.listDrivers({ status, q: req.query.q, country: req.query.country }) });
  }));

  // POST /admin/drivers/:id/approval { approved: true | false } -> approve, or suspend (also takes them offline)
  router.post('/drivers/:id/approval', handle(async (req, res) => {
    const { approved } = req.body ?? {};
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Driver not found' });
    if (typeof approved !== 'boolean') return res.status(400).json({ error: 'approved must be true or false' });
    const found = await admin.setApproval(req.params.id, { approved, by: req.user.id });
    if (!found) return res.status(404).json({ error: 'Driver not found' });
    res.json({ approved });
  }));

  // GET /admin/trips?status=&country=&before=<requestedAt of the last trip shown>
  router.get('/trips', handle(async (req, res) => {
    const { status, before } = req.query;
    if (status !== undefined && !TRIP_STATUSES.includes(status)) return res.status(400).json({ error: 'unknown status' });
    if (before !== undefined && Number.isNaN(Date.parse(before))) return res.status(400).json({ error: 'before must be a date' });
    res.json({ trips: await admin.listTrips({ status, before, country: req.query.country }) });
  }));

  // GET /admin/balances?country= -> drivers with money to settle
  router.get('/balances', handle(async (req, res) => {
    res.json({ balances: await admin.listBalances({ country: req.query.country }) });
  }));

  // GET /admin/settlements?driverId=
  router.get('/settlements', handle(async (req, res) => {
    const { driverId } = req.query;
    if (driverId !== undefined && !UUID.test(driverId)) return res.status(400).json({ error: 'unknown driver' });
    res.json({ settlements: await admin.listSettlements({ driverId }) });
  }));

  // POST /admin/settlements { driverId, direction: 'to_driver' | 'from_driver', amount, reference?, note? }
  // Records money that changed hands outside the app, e.g. a MoMo transfer to a driver.
  router.post('/settlements', handle(async (req, res) => {
    const { driverId, direction, amount, reference, note } = req.body ?? {};
    if (!(typeof driverId === 'string' && UUID.test(driverId))) return res.status(400).json({ error: 'choose a driver' });
    if (!['to_driver', 'from_driver'].includes(direction)) {
      return res.status(400).json({ error: 'direction must be "to_driver" or "from_driver"' });
    }
    if (!Number.isInteger(amount) || amount < 1) return res.status(400).json({ error: 'amount must be a positive whole number of pesewas or cents' });
    if (!optionalText(reference, 100) || !optionalText(note, 300)) return res.status(400).json({ error: 'reference or note is too long' });
    const country = await admin.driverCountry(driverId);
    if (!country) return res.status(404).json({ error: 'Driver not found' });
    const settlement = await admin.recordSettlement({
      driverId, direction, amount, currency: getMarket(country).currency, reference, note, recordedBy: req.user.id,
    });
    res.status(201).json({ settlement });
  }));

  return router;
}
