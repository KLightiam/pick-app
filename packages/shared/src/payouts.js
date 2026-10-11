import { parsePhoneNumberFromString } from 'libphonenumber-js';

// Paying drivers what Pick owes them. Ghana: mobile money through Paystack
// transfers. Germany: bank payouts through Stripe Connect.

/** Ghana's mobile money networks, with the codes Paystack uses for them. */
export const MOBILE_MONEY_NETWORKS = Object.freeze([
  Object.freeze({ code: 'MTN', label: 'MTN MoMo' }),
  Object.freeze({ code: 'VOD', label: 'Telecel Cash' }),
  Object.freeze({ code: 'ATL', label: 'AirtelTigo Money' }),
]);

export const PAYOUT_STATUSES = Object.freeze(['pending', 'paid', 'failed']);

/**
 * A Ghanaian mobile money number in the local form Paystack expects (0241234567),
 * or null if it isn't a Ghanaian mobile number.
 */
export function ghanaMobileMoneyNumber(input) {
  if (typeof input !== 'string') return null;
  const phone = parsePhoneNumberFromString(input.trim(), 'GH');
  if (!phone?.isValid() || phone.country !== 'GH') return null;
  const type = phone.getType();
  if (type && type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE') return null;
  return `0${phone.nationalNumber}`;
}

/** The number with its middle hidden, for showing on screen: 024•••4567. */
export function maskAccountNumber(number) {
  const s = String(number ?? '');
  return s.length > 6 ? `${s.slice(0, 3)}•••${s.slice(-4)}` : s;
}
