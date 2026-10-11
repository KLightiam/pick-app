import { distanceKm } from './geo.js';

// Placeholder pricing in minor currency units; tune per market later.
export const DEFAULT_PRICING = Object.freeze({
  baseFare: 500,
  perKm: 150,
  perMinute: 25,
  minimumFare: 800,
  avgSpeedKmh: 30,
  roadFactor: 1.3, // straight-line distance underestimates road distance
});

export function estimateFare(pickup, dropoff, pricing = DEFAULT_PRICING) {
  const km = distanceKm(pickup, dropoff) * pricing.roadFactor;
  const minutes = (km / pricing.avgSpeedKmh) * 60;
  const raw = pricing.baseFare + km * pricing.perKm + minutes * pricing.perMinute;
  return {
    distanceKm: Math.round(km * 10) / 10,
    durationMin: Math.round(minutes),
    fare: Math.max(pricing.minimumFare, Math.round(raw)),
  };
}
