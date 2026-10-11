// Display helpers. Prices from the API are in minor units (pesewas, cents).

const SYMBOLS = { GHS: 'GH₵', EUR: '€' };

export function formatMoney(minor, currency) {
  if (minor === null || minor === undefined) return '';
  return `${SYMBOLS[currency] ?? `${currency} `}${(minor / 100).toFixed(2)}`;
}

export function formatKm(km) {
  if (km === null || km === undefined) return '';
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export const MATCH_LABELS = {
  exact: 'Going to your destination',
  beyond: 'Passing your destination',
  partial: 'Takes you part of the way',
  anywhere: 'Takes you anywhere',
};

export const TRIP_STATUS_LABELS = {
  requested: 'Waiting for the driver to accept',
  accepted: 'Driver is on the way',
  arrived: 'Driver has arrived',
  in_progress: 'On the way',
  completed: 'Trip complete',
  cancelled: 'Trip cancelled',
};

/** The price line for a ride option, e.g. "Up to GH₵13.00 · GH₵11.00 if someone shares". */
export function describeFare(fare) {
  const max = formatMoney(fare.max, fare.currency);
  if (fare.ifShared === undefined) return max;
  return `Up to ${max} · ${formatMoney(fare.ifShared, fare.currency)} if someone shares`;
}

/** One line on where the passenger gets off. */
export function describeDropoff(option) {
  if (option.matchType === 'partial') {
    return `Drops you ${formatKm(option.remainingKm)} from your destination`;
  }
  return 'Drops you at your destination';
}

export const CANCELLABLE = ['requested', 'accepted', 'arrived'];

/** The driver's next button for a trip, and the API call it makes. */
export const DRIVER_NEXT_STEP = {
  accepted: { label: "I've arrived", call: 'arrived' },
  arrived: { label: 'Passenger is in, start trip', call: 'start' },
  in_progress: { label: 'Drop off and finish', call: 'complete' },
};

/** Offers the driver can still accept at `now`: newest first, without duplicates or expired ones. */
export function liveOffers(offers, now = Date.now()) {
  const seen = new Set();
  return offers
    .filter((o) => new Date(o.expiresAt).getTime() > now)
    .filter((o) => !seen.has(o.trip.id) && seen.add(o.trip.id));
}

/** Whole seconds left on an offer, never below 0. */
export function secondsLeft(expiresAt, now = Date.now()) {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
}

/** Opens turn-by-turn directions to a point in the phone's maps app (or Google Maps on the web). */
export function directionsUrl({ lat, lng }) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/** How a rider can pay in the app, by country: Paystack takes mobile money in Ghana. */
export function appPaymentLabel(country) {
  return country === 'GH' ? 'Card or MoMo' : 'Card';
}

/** One line on a finished ride's payment, for the rider or the driver. */
export function describePayment(payment, who) {
  if (!payment) return '';
  const amount = formatMoney(payment.amount, payment.currency);
  if (payment.method === 'cash') return who === 'driver' ? `Collect ${amount} in cash` : `Pay your driver ${amount} in cash`;
  if (payment.status === 'paid') return `${amount} paid in the app`;
  return who === 'driver' ? `${amount} to be paid in the app` : `${amount} to pay in the app`;
}
