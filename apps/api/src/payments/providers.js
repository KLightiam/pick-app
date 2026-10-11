import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

// Hosted checkout pages: the rider pays on Paystack's or Stripe's own page, so
// card and mobile money details never touch Pick. Each provider can:
//   createCheckout({ payment, email, returnUrl }) -> { ref, url }
//   checkStatus(ref) -> { paid, paymentId, amount, currency }
//   parseWebhook(rawBody, headers) -> { paymentId, amount, currency } for a successful payment, null to ignore
// parseWebhook throws WebhookSignatureError when the request didn't come from the provider.
//
// They also pay drivers (see payouts/service.js):
//   createRecipient({ driverId, name, accountNumber, network, currency }) -> { ref, ready }
//   onboardingLink(ref, { returnUrl }) -> url, for providers whose recipients sign up on the provider's own page (Stripe)
//   recipientReady(ref) -> boolean
//   transfer({ payout, account }) -> { ref, status: 'paid' | 'pending' | 'failed', reason? }
//   checkTransfer({ payout, account }) -> { status, reason? }, for a transfer whose outcome Pick didn't hear
// and parseWebhook returns { kind: 'payment', ... } or { kind: 'payout', payoutId, status, reason }.

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
      const d = event.data ?? {};
      if (event.event === 'charge.success') {
        return { kind: 'payment', paymentId: d.metadata?.paymentId, amount: d.amount, currency: d.currency };
      }
      const transfer = PAYSTACK_TRANSFER_EVENTS[event.event];
      if (transfer && String(d.reference).startsWith(PAYOUT_PREFIX)) {
        return { kind: 'payout', payoutId: d.reference.slice(PAYOUT_PREFIX.length), ...transfer };
      }
      return null;
    },

    // Transfers to mobile money. https://paystack.com/docs/transfers/single-transfers
    // Paystack sends transfers without asking for an OTP only once OTP is turned off in its dashboard.
    async createRecipient({ name, accountNumber, network, currency }) {
      const body = await readJson(await fetchFn(`${baseUrl}/transferrecipient`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ type: 'mobile_money', name, account_number: accountNumber, bank_code: network, currency }),
      }), 'Paystack');
      return { ref: body.data.recipient_code, ready: true };
    },

    recipientReady: async () => true,

    async transfer({ payout, account }) {
      const reference = `${PAYOUT_PREFIX}${payout.id}`; // lowercase letters, digits, - and _, 16 to 50 characters
      const body = await readJson(await fetchFn(`${baseUrl}/transfer`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          source: 'balance', amount: payout.amount, currency: payout.currency, recipient: account.providerRef,
          reference, reason: 'Pick earnings',
        }),
      }), 'Paystack');
      return { ref: reference, ...paystackTransferStatus(body.data.status) };
    },

    async checkTransfer({ payout }) {
      const res = await fetchFn(`${baseUrl}/transfer/verify/${PAYOUT_PREFIX}${payout.id}`, { headers });
      if (res.status === 404) return { status: 'failed', reason: 'Paystack never received the transfer' };
      const body = await readJson(res, 'Paystack');
      return paystackTransferStatus(body.data.status);
    },
  };
}

const PAYOUT_PREFIX = 'pick-payout-';

const PAYSTACK_TRANSFER_EVENTS = {
  'transfer.success': { status: 'paid' },
  'transfer.failed': { status: 'failed', reason: 'Paystack could not send the transfer' },
  'transfer.reversed': { status: 'failed', reason: 'Paystack reversed the transfer' },
};

function paystackTransferStatus(status) {
  if (status === 'success') return { status: 'paid' };
  if (status === 'failed' || status === 'reversed') return { status: 'failed', reason: `Paystack says the transfer ${status}` };
  if (status === 'otp') {
    return { status: 'failed', reason: 'Paystack wants an OTP for each transfer. Turn off OTP for transfers in the Paystack dashboard.' };
  }
  return { status: 'pending' }; // pending, processing, queued
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
      return result.paid ? { kind: 'payment', ...result } : null;
    },

    // Stripe Connect Express: the driver gives Stripe their identity and bank details on Stripe's own
    // onboarding page, Pick transfers their earnings to that account, and Stripe pays it out to their bank.
    // https://docs.stripe.com/connect/express-accounts
    async createRecipient({ driverId }) {
      const account = await readJson(await fetchFn(`${baseUrl}/v1/accounts`, {
        method: 'POST',
        headers,
        body: new URLSearchParams({
          type: 'express',
          country: 'DE',
          business_type: 'individual',
          'capabilities[transfers][requested]': 'true',
          'metadata[driverId]': driverId,
        }),
      }), 'Stripe');
      return { ref: account.id, ready: false };
    },

    async onboardingLink(ref, { returnUrl }) {
      const link = await readJson(await fetchFn(`${baseUrl}/v1/account_links`, {
        method: 'POST',
        headers,
        body: new URLSearchParams({ account: ref, type: 'account_onboarding', return_url: returnUrl, refresh_url: returnUrl }),
      }), 'Stripe');
      return link.url;
    },

    async recipientReady(ref) {
      const account = await readJson(await fetchFn(`${baseUrl}/v1/accounts/${encodeURIComponent(ref)}`, { headers }), 'Stripe');
      return account.capabilities?.transfers === 'active' && account.payouts_enabled === true;
    },

    // A transfer either goes through straight away or fails (for example when Pick's Stripe balance is too low).
    async transfer({ payout, account }) {
      const res = await fetchFn(`${baseUrl}/v1/transfers`, {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': `payout-${payout.id}` },
        body: new URLSearchParams({
          amount: String(payout.amount),
          currency: payout.currency.toLowerCase(),
          destination: account.providerRef,
          'metadata[payoutId]': payout.id,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status >= 500 || res.status === 429) throw new Error(`Stripe responded ${res.status}`); // outcome unknown: check again later
      if (!res.ok) return { ref: null, status: 'failed', reason: `Stripe: ${body.error?.message ?? res.status}` };
      return { ref: body.id, status: 'paid' };
    },

    // Sending the same transfer again with the same idempotency key returns what Stripe did the first time.
    async checkTransfer({ payout, account }) {
      return this.transfer({ payout, account });
    },
  };
}

/**
 * For development without Paystack or Stripe keys: the "checkout" is a page on
 * the API itself with a Pay button. Never used in production.
 */
export function testProvider({ publicUrl }) {
  const refs = new Map(); // ref -> { paymentId, amount, currency, paid }
  let failNext = false;
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

    // Payouts always go through straight away, unless failNextTransfer() was called.
    async createRecipient() {
      return { ref: `test_rcp_${randomUUID()}`, ready: true };
    },
    recipientReady: async () => true,
    async transfer() {
      if (failNext) {
        failNext = false;
        return { ref: null, status: 'failed', reason: 'Test transfer failed' };
      }
      return { ref: `test_trf_${randomUUID()}`, status: 'paid' };
    },
    checkTransfer: async () => ({ status: 'paid' }),
    failNextTransfer() {
      failNext = true;
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
