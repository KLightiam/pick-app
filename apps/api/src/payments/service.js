import { MARKETS, driverBalance, splitEarnings } from '@pick/shared';

export class PaymentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const marketFor = (currency) => Object.values(MARKETS).find((m) => m.currency === currency);

/**
 * Riders pay after drop-off, so they only ever pay the final fare (which can be
 * lower than the price shown at booking). Cash goes to the driver; app payments
 * go through the market's provider and are confirmed by its webhook, or by
 * checking with the provider when the rider comes back to the app.
 */
export function createPayments({ repo, providers, notifier, publicUrl, emailDomain, now = () => new Date() }) {
  const confirm = async (paymentId, { amount, currency }) => {
    const payment = paymentId && (await repo.findById(paymentId));
    if (!payment) return null;
    if (amount !== payment.amount || String(currency).toUpperCase() !== payment.currency) {
      console.error(`payment ${payment.id}: provider reported ${amount} ${currency}, expected ${payment.amount} ${payment.currency}`);
      return null;
    }
    const paid = await repo.markPaid(payment.id, now());
    if (!paid) return repo.findById(payment.id); // already paid, e.g. webhook and app check both arrived
    notifier.toUser(paid.riderId, 'payment:paid', { payment: paid });
    notifier.toUser(paid.driverId, 'payment:paid', { payment: paid });
    return paid;
  };

  return {
    /** Records what a completed trip costs and how it's paid. Safe to call twice. */
    async recordForTrip(trip) {
      const market = marketFor(trip.currency);
      const { commission } = splitEarnings(trip.fareFinal, market.commissionRate);
      const app = trip.paymentMethod === 'app';
      return repo.create({
        tripId: trip.id,
        riderId: trip.riderId,
        driverId: trip.driverId,
        method: trip.paymentMethod,
        provider: app ? providers[market.paymentProvider].name : null,
        amount: trip.fareFinal,
        commission,
        currency: trip.currency,
        status: app ? 'pending' : 'cash',
      });
    },

    unpaidFor: (riderId) => repo.findUnpaidForRider(riderId),
    forTrip: (tripId) => repo.findByTrip(tripId),

    /** Starts paying in the app: returns the provider's checkout page for the rider to open. */
    async startCheckout(rider, tripId) {
      const payment = await repo.findByTrip(tripId);
      if (!payment || payment.riderId !== rider.id) throw new PaymentError(404, 'Nothing to pay for this trip');
      if (payment.method !== 'app') throw new PaymentError(409, 'This ride is paid in cash');
      if (payment.status === 'paid') throw new PaymentError(409, 'This ride is already paid');

      const provider = providers[payment.provider];
      // Paystack needs an email address. Pick signs people in by phone, so it gets one made from the account id.
      const email = `rider-${rider.id}@${emailDomain}`;
      const { ref, url } = await provider.createCheckout({
        payment, email, returnUrl: `${publicUrl}/payments/return`,
      });
      const updated = await repo.setCheckout(payment.id, { providerRef: ref, checkoutUrl: url });
      return { payment: updated ?? payment, checkoutUrl: url };
    },

    /** Asks the provider about a pending payment, for when the rider returns before the webhook arrives. */
    async refresh(payment) {
      if (payment?.status !== 'pending' || !payment.providerRef) return payment;
      try {
        const status = await providers[payment.provider].checkStatus(payment.providerRef);
        if (status.paid && status.paymentId === payment.id) return (await confirm(payment.id, status)) ?? payment;
      } catch (err) {
        console.error('payment check', err.message);
      }
      return payment;
    },

    /** A provider's webhook. Throws WebhookSignatureError if it isn't genuine. */
    async handleWebhook(providerName, rawBody, headers) {
      const provider = providers[providerName];
      if (!provider || provider.name !== providerName) return null;
      const event = provider.parseWebhook(rawBody, headers);
      return event ? confirm(event.paymentId, event) : null;
    },

    /** The test checkout page's Pay button. */
    async payTestCheckout(ref) {
      const r = providers.test.pay(ref);
      return r ? confirm(r.paymentId, r) : null;
    },

    /** What the driver earned since `since`, and their balance with Pick. */
    async earnings(driverId, { since }) {
      const payments = await repo.listForDriver(driverId, { since });
      const currency = payments[0]?.currency ?? null;
      const rides = payments.map((p) => ({
        tripId: p.tripId, method: p.method, status: p.status, amount: p.amount,
        commission: p.commission, earned: p.amount - p.commission, createdAt: p.createdAt,
      }));
      return { since: since.toISOString(), currency, rides, ...driverBalance(payments) };
    },
  };
}
