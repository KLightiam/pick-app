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
 * Settlements are money that has since changed hands to square up.
 * Positive: Pick owes the driver. Negative: the driver owes Pick.
 * (The driver_balances view in db/migrations/007_admin.sql does the same in SQL.)
 * payments: [{ method, status, amount, commission }]
 * settlements: [{ direction: 'to_driver' | 'from_driver', amount }]
 */
export function driverBalance(payments, settlements = []) {
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
  const settled = (direction) => settlements.filter((x) => x.direction === direction).reduce((sum, x) => sum + x.amount, 0);
  const paidToDriver = settled('to_driver');
  const paidByDriver = settled('from_driver');
  return {
    rides: payments.length,
    owedToDriver,
    cashCollected,
    commissionOnCash,
    paidToDriver,
    paidByDriver,
    balance: owedToDriver - commissionOnCash - paidToDriver + paidByDriver,
  };
}
