const SYMBOLS = { GHS: 'GH₵', EUR: '€' };

/** Minor units (pesewas, cents) to a price, e.g. 2837 GHS -> "GH₵28.37". Negative amounts keep their sign. */
export function formatMoney(minor, currency) {
  if (minor === null || minor === undefined) return '—';
  const sign = minor < 0 ? '−' : '';
  return `${sign}${SYMBOLS[currency] ?? `${currency} `}${(Math.abs(minor) / 100).toFixed(2)}`;
}

/** "GH₵24.11" typed by an admin -> 2411. Returns null for anything that isn't a positive amount. */
export function parseMoney(text) {
  const m = String(text).trim().replace(',', '.').match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const minor = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return minor > 0 ? minor : null;
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export const STATUS_LABELS = {
  requested: 'Requested',
  accepted: 'Driver on the way',
  arrived: 'Driver arrived',
  in_progress: 'On the way',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** What a driver's balance means, in words. */
export function describeBalance(balance, currency) {
  if (!balance) return 'Settled';
  return balance > 0
    ? `Pick owes ${formatMoney(balance, currency)}`
    : `Owes Pick ${formatMoney(-balance, currency)}`;
}

/** How a trip was paid, in words. */
export function describePayment(trip) {
  if (trip.status !== 'completed') return trip.paymentMethod === 'app' ? 'App' : 'Cash';
  if (trip.paymentMethod === 'cash') return 'Cash';
  return trip.paymentStatus === 'paid' ? 'App · paid' : 'App · unpaid';
}

/** What riders and drivers can report (the same codes as @pick/shared REPORT_CATEGORIES). */
export const REPORT_LABELS = {
  safety: 'Felt unsafe',
  behaviour: 'Rude or unpleasant behaviour',
  driving: 'Dangerous driving',
  payment: 'Fare or payment',
  lost_item: 'Lost item',
  other: 'Something else',
};

/** "4.6 ★ (12)", or "No ratings" for a driver nobody has rated yet. */
export function formatRating(rating) {
  if (!rating?.count) return 'No ratings';
  return `${rating.average.toFixed(1)} ★ (${rating.count})`;
}

/** A person's number, or that they deleted their account (the API keeps their trips without it). */
export function phoneLabel(phone) {
  return phone?.startsWith('deleted:') ? 'Deleted account' : phone;
}
