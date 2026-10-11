// What each live event says as a push notification, for when the Pick app is closed.
// Events that need no notification (the rider's own payment, the car moving) return null.

const SYMBOLS = { GHS: 'GH₵', EUR: '€' };
const money = (minor, currency) => `${SYMBOLS[currency] ?? `${currency} `}${(minor / 100).toFixed(2)}`;

/** -> { title, body, data } or null. `userId` is who the event is for. */
export function pushMessageFor(event, payload, userId) {
  const trip = payload?.trip;
  const data = { event, tripId: trip?.id ?? payload?.tripId ?? null };
  switch (event) {
    case 'trip:offer':
      return {
        title: 'New ride request',
        body: `${trip.pickupAddress ? `Pickup: ${trip.pickupAddress}` : 'A passenger near you'} · ${money(trip.fareEstimate, trip.currency)}. Open Pick to accept.`,
        data,
        urgent: true,
      };
    case 'trip:accepted': {
      const car = [payload.driver?.vehicleMake, payload.driver?.vehiclePlate].filter(Boolean).join(' · ');
      return {
        title: 'Your driver is on the way',
        body: `${payload.driver?.name ?? 'Your driver'} accepted your ride${car ? ` (${car})` : ''}.`,
        data,
      };
    }
    case 'trip:status':
      return trip.status === 'arrived'
        ? { title: 'Your driver has arrived', body: 'Your driver is waiting at the pickup.', data }
        : null;
    case 'trip:completed':
      return {
        title: 'Trip complete',
        body: trip.paymentMethod === 'app'
          ? `Your fare is ${money(trip.fareFinal, trip.currency)}. Open Pick to pay.`
          : `Your fare is ${money(trip.fareFinal, trip.currency)}. Please pay the driver in cash.`,
        data,
      };
    case 'trip:cancelled':
      return {
        title: 'Ride cancelled',
        body: trip.cancelledBy === 'rider' ? 'The passenger cancelled the ride.' : 'Your driver cancelled. Open Pick to choose another.',
        data,
      };
    case 'payment:paid':
      return userId === payload.payment.driverId
        ? { title: 'Ride paid', body: `${money(payload.payment.amount, payload.payment.currency)} paid in the app.`, data }
        : null;
    case 'payout:updated': {
      const p = payload.payout;
      if (p.status === 'paid') return { title: 'Payout sent', body: `Pick sent you ${money(p.amount, p.currency)}.`, data };
      if (p.status === 'failed') {
        return { title: "Payout didn't go through", body: `Pick couldn't send ${money(p.amount, p.currency)}. It stays on your balance.`, data };
      }
      return null;
    }
    default:
      return null;
  }
}
