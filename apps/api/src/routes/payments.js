import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { WebhookSignatureError } from '../payments/providers.js';

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 16px;text-align:center;color:#1a1a1a}
button{background:#0B6E4F;color:#fff;border:0;border-radius:10px;padding:14px 28px;font-size:16px}</style>
</head><body>${body}</body></html>`;

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function paymentsRouter({ tokens, payments, trips, testCheckout }) {
  const router = Router();

  // GET /payments/unpaid -> { payment, trip } for a ride the rider still has to pay for, or { payment: null }
  router.get('/unpaid', requireAuth(tokens), requireRole('rider'), async (req, res, next) => {
    try {
      const payment = await payments.refresh(await payments.unpaidFor(req.user.id));
      if (!payment || payment.status !== 'pending') return res.json({ payment: null });
      res.json({ payment, trip: await trips.findById(payment.tripId) });
    } catch (err) {
      next(err);
    }
  });

  // POST /payments/webhooks/paystack and /payments/webhooks/stripe
  router.post('/webhooks/:provider', async (req, res, next) => {
    try {
      await payments.handleWebhook(req.params.provider, req.rawBody ?? Buffer.alloc(0), req.headers);
      res.json({ received: true });
    } catch (err) {
      if (err instanceof WebhookSignatureError) return res.status(400).json({ error: 'invalid signature' });
      next(err);
    }
  });

  // Where Paystack and Stripe send the rider after paying.
  router.get('/return', (_req, res) => {
    res.type('html').send(page('Pick', '<h1>Thanks</h1><p>You can go back to the Pick app now.</p>'));
  });

  // A stand-in checkout page for development without Paystack or Stripe keys.
  if (testCheckout) {
    router.get('/test-checkout/:ref', (req, res) => {
      const r = testCheckout.lookup(req.params.ref);
      if (!r) return res.status(404).type('html').send(page('Pick', '<p>Unknown payment</p>'));
      const amount = `${r.currency} ${(r.amount / 100).toFixed(2)}`;
      res.type('html').send(page('Test checkout', r.paid
        ? '<h1>Paid</h1><p>You can go back to the Pick app now.</p>'
        : `<h1>Test checkout</h1><p>No real money moves. This page stands in for Paystack or Stripe.</p>
           <form method="post"><button>Pay ${escape(amount)}</button></form>`));
    });
    router.post('/test-checkout/:ref', async (req, res, next) => {
      try {
        await payments.payTestCheckout(req.params.ref);
        res.redirect(303, `${req.baseUrl}/return`);
      } catch (err) {
        next(err);
      }
    });
  }

  return router;
}
