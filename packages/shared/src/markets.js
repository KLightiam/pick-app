import { parsePhoneNumberFromString } from 'libphonenumber-js';

// Countries Pick operates in. Prices are in minor units of the local currency
// (pesewas, cents) and are placeholders until real pricing is set.
export const MARKETS = Object.freeze({
  GH: Object.freeze({
    country: 'GH',
    name: 'Ghana',
    currency: 'GHS',
    paymentProvider: 'paystack',
    pricing: Object.freeze({
      baseFare: 500, perKm: 250, perMinute: 30, minimumFare: 1000, avgSpeedKmh: 25, roadFactor: 1.3,
    }),
  }),
  DE: Object.freeze({
    country: 'DE',
    name: 'Germany',
    currency: 'EUR',
    paymentProvider: 'stripe',
    pricing: Object.freeze({
      baseFare: 400, perKm: 200, perMinute: 40, minimumFare: 800, avgSpeedKmh: 30, roadFactor: 1.3,
    }),
  }),
});

export function getMarket(country) {
  return MARKETS[country] ?? null;
}

/**
 * Normalizes a phone number to E.164 and finds its market.
 * Returns null unless it is a valid mobile-capable number in a market Pick serves.
 */
export function parseMarketPhone(input) {
  if (typeof input !== 'string') return null;
  const phone = parsePhoneNumberFromString(input.trim());
  if (!phone?.isValid() || !MARKETS[phone.country]) return null;
  const type = phone.getType();
  if (type && type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE') return null;
  return { phone: phone.number, country: phone.country };
}
