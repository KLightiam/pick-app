import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

// Hosted checkout pages: the rider pays on Paystack's or Stripe's own page, so
// card and mobile money details never touch Pick. Each provider can:
//   createCheckout({ payment, email, returnUrl }) -> { ref, url }
//   checkStatus(ref) -> { paid, paymentId, amount, currency }
//   parseWebhook(rawBody, headers) -> { paymentId, amount, currency } for a successful payment, null to ignore
// parseWebhook throws WebhookSignatureError when the request didn't come from the provider.

export class WebhookSignatureError extends Error {}

const sameHex = (a, b) => {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};

async function readJson(res, what) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${what} responded ${res.status}: ${body.message ?? body.error?.message ?? ''}`);
  return body;
}

/** Paystack (Ghana): card and mobile money. https://paystack.com/docs/payments/accept-payments */
export function paystackProvider({ secretKey, baseUrl = 'https://api.paystack.co', fetchFn = fetch }) {
  const headers = { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' };
  return {
    name: 'paystack',

    async createCheckout({ payment, email, returnUrl }) {
      const reference = `pick-${payment.id}-${Date.now()}`; // Paystack allows letters, digits, - . =
      const body = await readJson(await fetchFn(`${baseUrl}/transaction/initialize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email,
          amount: payment.amount,
          currency: payment.currency,
          reference,
          callback_url: returnUrl,
          channels: ['card', 'mobile_money'],
          metadata: { paymentId: payment.id, tripId: payment.tripId },
        }),
      }), 'Paystack');
      return { ref: body.data.reference, url: body.data.authorization_url };
    },

    async checkStatus(ref) {
      const body = await readJson(
        await fetchFn(`${baseUrl}/transaction/verify/${encodeURIComponent(ref)}`, { headers }),
        'Paystack',
      );
      const d = body.data;
      return { paid: d.status === 'success', paymentId: d.metadata?.paymentId, amount: d.amount, currency: d.currency };
    },

    // Paystack signs the raw body with HMAC-SHA512 using the secret key.
    parseWebhook(rawBody, headers) {
      const expected = createHmac('sha512', secretKey).update(rawBody).digest('hex');
      if (!sameHex(expected, headers['x-paystack-signature'])) throw new WebhookSignatureError();
      const event = JSON.parse(rawBody.toString('utf8'));
      if (event.event !== 'charge.success') return null;
      const d = event.data;
      return { paymentId: d.metadata?.paymentId, amount: d.amount, currency: d.currency };
    },
  };
}

/** Stripe (Germany): card payments through Stripe Checkout. https://docs.stripe.com/payments/checkout */
export function stripeProvider({
  secretKey, webhookSecret, baseUrl = 'https://api.stripe.com', fetchFn = fetch, now = () => Date.now(),
}) {
  const headers = { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  const fromSession = (s) => ({
    paid: s.payment_status === 'paid',
    paymentId: s.client_reference_id ?? s.metadata?.paymentId,
    amount: s.amount_total,
    currency: s.currency,
  });

  return {
    name: 'stripe',

    async createCheckout({ payment, returnUrl }) {
      const form = new URLSearchParams({
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': payment.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': String(payment.amount),
        'line_items[0][price_data][product_data][name]': 'Pick ride',
        client_reference_id: payment.id,
        'metadata[paymentId]': payment.id,
        'metadata[tripId]': payment.tripId,
        success_url: returnUrl,
        cancel_url: returnUrl,
      });
      const body = await readJson(
        await fetchFn(`${baseUrl}/v1/checkout/sessions`, { method: 'POST', headers, body: form }),
        'Stripe',
      );
      return { ref: body.id, url: body.url };
    },

    async checkStatus(ref) {
      const s = await readJson(
        await fetchFn(`${baseUrl}/v1/checkout/sessions/${encodeURIComponent(ref)}`, { headers }),
        'Stripe',
      );
      return fromSession(s);
    },

    // Stripe-Signature: t=<unix time>,v1=<HMAC-SHA256 of "t.body" with the endpoint's signing secret>.
    parseWebhook(rawBody, headers) {
      const parts = Object.fromEntries(
        String(headers['stripe-signature'] ?? '').split(',').map((kv) => kv.split('=')),
      );
      const t = Number(parts.t);
      const expected = createHmac('sha256', webhookSecret).update(`${parts.t}.${rawBody}`).digest('hex');
      if (!webhookSecret || !sameHex(expected, parts.v1) || Math.abs(now() / 1000 - t) > 300) {
        throw new WebhookSignatureError();
      }
      const event = JSON.parse(rawBody.toString('utf8'));
      if (event.type !== 'checkout.session.completed') return null;
      const result = fromSession(event.data.object);
      return result.paid ? result : null;
    },
  };
}

/**
 * For development without Paystack or Stripe keys: the "checkout" is a page on
 * the API itself with a Pay button. Never used in production.
 */
export function testProvider({ publicUrl }) {
  const refs = new Map(); // ref -> { paymentId, amount, currency, paid }
  return {
    name: 'test',

    async createCheckout({ payment }) {
      const ref = `test_${randomUUID()}`;
      refs.set(ref, { paymentId: payment.id, amount: payment.amount, currency: payment.currency, paid: false });
      return { ref, url: `${publicUrl}/payments/test-checkout/${ref}` };
    },

    async checkStatus(ref) {
      const r = refs.get(ref);
      return r ? { ...r } : { paid: false };
    },

    parseWebhook() {
      throw new WebhookSignatureError();
    },

    /** Used by the test checkout page. */
    lookup: (ref) => refs.get(ref) ?? null,
    pay(ref) {
      const r = refs.get(ref);
      if (r) r.paid = true;
      return r ?? null;
    },
  };
}

/** Paystack and Stripe when their keys are set; otherwise the test checkout, outside production only. */
export function createPaymentProviders(config) {
  const test = testProvider({ publicUrl: config.publicUrl });
  const fallback = (name) => {
    if (config.isProduction) throw new Error(`${name} keys must be set in production`);
    console.warn(`No ${name} keys set: app payments use the test checkout page`);
    return test;
  };
  return {
    paystack: config.paystackSecretKey ? paystackProvider({ secretKey: config.paystackSecretKey }) : fallback('Paystack'),
    stripe: config.stripeSecretKey
      ? stripeProvider({ secretKey: config.stripeSecretKey, webhookSecret: config.stripeWebhookSecret })
      : fallback('Stripe'),
    test,
  };
}
