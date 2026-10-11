import { MARKETS, MOBILE_MONEY_NETWORKS, ghanaMobileMoneyNumber, maskAccountNumber } from '@pick/shared';

export class PayoutError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DAY = 24 * 60 * 60 * 1000;
const STALE_AFTER = 15 * 60 * 1000; // a payout still pending after this gets checked with the provider

/** What the driver and admins see of an account: never the provider's ids, and the number masked. */
const publicAccount = (a) => a && {
  method: a.method,
  provider: a.provider,
  accountName: a.accountName,
  accountNumber: maskAccountNumber(a.accountNumber),
  network: a.network,
  networkLabel: MOBILE_MONEY_NETWORKS.find((n) => n.code === a.network)?.label ?? null,
  ready: a.ready,
};

/**
 * Pays drivers what Pick owes them: their balance (app earnings, less commission
 * on cash rides, less what was already paid). Every week once it reaches the
 * market's minimum, or straight away when an admin presses Pay now.
 */
export function createPayouts({ repo, balances, providers, notifier, publicUrl, now = () => new Date() }) {
  const providerFor = (country) => providers[MARKETS[country].paymentProvider];

  const finish = async (payout, result) => {
    const updated = await repo.updatePayout(payout.id, {
      status: result.status, providerRef: result.ref, reason: result.status === 'failed' ? result.reason : null, at: now(),
    });
    if (updated) notifier.toUser(updated.driverId, 'payout:updated', { payout: updated });
    return updated ?? (await repo.findPayout(payout.id));
  };

  const payouts = {
    /** The driver's payout account, checking with Stripe whether a new one has finished sign-up. */
    async account(driverId) {
      let account = await repo.findAccount(driverId);
      if (account && !account.ready) {
        try {
          if (await providers[account.provider].recipientReady(account.providerRef)) {
            account = await repo.setAccountReady(driverId, true);
          }
        } catch (err) {
          console.error('payout account check', err.message);
        }
      }
      return publicAccount(account);
    },

    /**
     * Ghana: { name, number, network } saves the driver's mobile money account.
     * Germany: starts (or continues) Stripe's sign-up and returns its page as onboardingUrl.
     */
    async setup(user, details = {}) {
      const market = MARKETS[user.country];
      const provider = providerFor(user.country);

      if (market.payout.method === 'mobile_money') {
        const network = MOBILE_MONEY_NETWORKS.find((n) => n.code === details.network);
        const number = ghanaMobileMoneyNumber(details.number);
        const name = typeof details.name === 'string' ? details.name.trim() : '';
        if (!network) throw new PayoutError(400, 'Choose your mobile money network');
        if (!number) throw new PayoutError(400, 'Enter a Ghanaian mobile money number');
        if (name.length < 2 || name.length > 100) throw new PayoutError(400, 'Enter the name on the mobile money account');
        let recipient;
        try {
          recipient = await provider.createRecipient({
            driverId: user.id, name, accountNumber: number, network: network.code, currency: market.currency,
          });
        } catch (err) {
          console.error('payout recipient', err.message);
          throw new PayoutError(502, "Paystack didn't accept these details. Check the number and network.");
        }
        const account = await repo.saveAccount({
          driverId: user.id, provider: provider.name, method: 'mobile_money', accountName: name, accountNumber: number,
          network: network.code, providerRef: recipient.ref, ready: recipient.ready,
        });
        return { account: publicAccount(account), onboardingUrl: null };
      }

      let account = await repo.findAccount(user.id);
      if (!account || account.provider !== provider.name) {
        let recipient;
        try {
          recipient = await provider.createRecipient({ driverId: user.id, currency: market.currency });
        } catch (err) {
          console.error('payout recipient', err.message);
          throw new PayoutError(502, "Couldn't start payout sign-up with Stripe. Please try again.");
        }
        account = await repo.saveAccount({
          driverId: user.id, provider: provider.name, method: 'stripe', providerRef: recipient.ref, ready: recipient.ready,
        });
      }
      if (account.ready) return { account: publicAccount(account), onboardingUrl: null };
      const onboardingUrl = await provider.onboardingLink(account.providerRef, { returnUrl: `${publicUrl}/payments/payout-return` });
      return { account: publicAccount(account), onboardingUrl };
    },

    /** How often and from what amount this country's drivers are paid. */
    schedule(country) {
      const { minimum, everyDays, method } = MARKETS[country].payout;
      return { method, minimum, everyDays, currency: MARKETS[country].currency };
    },

    history: (driverId, options) => repo.listForDriver(driverId, options),
    list: (filters) => repo.list(filters),

    /**
     * Sends the driver their whole balance. requestedBy is the admin who pressed Pay now (null for the weekly run).
     * Throws PayoutError when there's no account, nothing owed, or a payout already on its way.
     */
    async payDriver(driverId, { requestedBy = null, minimum = 1 } = {}) {
      const account = await repo.findAccount(driverId);
      if (!account?.ready) throw new PayoutError(409, "This driver hasn't set up payouts yet");
      const balance = await balances.balanceFor(driverId);
      if (!balance || balance.balance < minimum) {
        const [last] = await repo.listForDriver(driverId, { limit: 1 });
        if (last?.status === 'pending') throw new PayoutError(409, 'A payout to this driver is already on its way');
        throw new PayoutError(409, 'Pick owes this driver nothing to pay out');
      }
      const payout = await repo.createPayout({
        driverId, amount: balance.balance, currency: balance.currency, provider: account.provider, requestedBy, at: now(),
      });
      if (!payout) throw new PayoutError(409, 'A payout to this driver is already on its way');

      let result;
      try {
        result = await providers[account.provider].transfer({ payout, account });
      } catch (err) {
        // We can't tell whether the money left, so it stays pending (and off the balance) until checked again.
        console.error(`payout ${payout.id}`, err.message);
        return payout;
      }
      return finish(payout, result);
    },

    /** A provider told Pick how a transfer went (Paystack's webhook). */
    async handleEvent({ payoutId, status, reason }) {
      const payout = payoutId && (await repo.findPayout(payoutId));
      if (!payout || payout.status !== 'pending' || status === 'pending') return payout ?? null;
      return finish(payout, { status, reason });
    },

    /**
     * The weekly run, safe to call as often as you like: pays every driver owed at least their market's
     * minimum who wasn't paid in the last week, and checks on payouts Pick never heard back about.
     */
    async runDue() {
      const summary = { paid: 0, pending: 0, failed: 0, checked: 0 };
      for (const payout of await repo.listStale(new Date(now().getTime() - STALE_AFTER))) {
        try {
          const account = await repo.findAccount(payout.driverId);
          const result = await providers[payout.provider].checkTransfer({ payout, account });
          if (result.status !== 'pending') await finish(payout, result);
          summary.checked++;
        } catch (err) {
          console.error(`payout check ${payout.id}`, err.message);
        }
      }

      for (const c of await repo.candidates()) {
        const { minimum, everyDays } = MARKETS[c.country].payout;
        const recent = c.lastPayoutAt && now() - new Date(c.lastPayoutAt) < everyDays * DAY;
        if (c.balance < minimum || recent) continue;
        try {
          const payout = await payouts.payDriver(c.driverId, { minimum });
          summary[payout.status]++;
        } catch (err) {
          if (!(err instanceof PayoutError)) console.error(`payout to ${c.driverId}`, err.message);
        }
      }
      return summary;
    },
  };
  return payouts;
}
