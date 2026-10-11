// How a fare splits between the driver and Pick. Amounts are in minor units.

export const PAYMENT_METHODS = Object.freeze(['cash', 'app']);

/** Pick's commission on a fare, rounded to the nearest minor unit, and what the driver keeps. */
export function splitEarnings(fare, commissionRate) {
  const commission = Math.round(fare * commissionRate);
  return { commission, driverEarnings: fare - commission };
}

/**
 * A driver's balance with Pick. App payments are collected by Pick and owed to
 * the driver; on cash rides the driver holds the money and owes Pick its commission.
 * payments: [{ method, status, amount, commission }]
 */
export function driverBalance(payments) {
  let owedToDriver = 0;
  let cashCollected = 0;
  let commissionOnCash = 0;
  for (const p of payments) {
    if (p.method === 'app' && p.status === 'paid') owedToDriver += p.amount - p.commission;
    if (p.method === 'cash') {
      cashCollected += p.amount;
      commissionOnCash += p.commission;
    }
  }
  return { owedToDriver, cashCollected, commissionOnCash, balance: owedToDriver - commissionOnCash };
}
