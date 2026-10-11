import { money as formatMoney } from '../push/messages.js';

export class AccountError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Deleting your own account, once nothing is left open: no ride under way and no money to settle. */
export function createAccounts({ users, trips, payments, balances, storage }) {
  return {
    async deleteAccount(user) {
      if (user.role === 'admin') throw new AccountError(403, 'Admin accounts are removed by another admin');
      const active = user.role === 'driver'
        ? await trips.findActiveForDriver(user.id)
        : [await trips.findActiveForRider(user.id)].filter(Boolean);
      if (active.length) throw new AccountError(409, 'Finish or cancel your current ride first');
      if (user.role === 'rider' && (await payments.unpaidFor(user.id))) {
        throw new AccountError(409, 'Pay for your last ride first');
      }
      if (user.role === 'driver') {
        const balance = await balances.balanceFor(user.id);
        if (balance?.balance > 0) {
          throw new AccountError(409, `Pick still owes you ${formatMoney(balance.balance, balance.currency)}. Get it paid out first, or contact Pick.`);
        }
        if (balance?.balance < 0) {
          throw new AccountError(409, `You owe Pick ${formatMoney(-balance.balance, balance.currency)} in commission. Settle it first.`);
        }
      }
      const removed = await users.deleteAccount(user.id);
      if (!removed) throw new AccountError(404, 'Account not found');
      // The records are already gone; a file that fails to delete is only logged.
      await Promise.all(removed.documentKeys.map((key) => storage.remove(key).catch((err) => console.error('delete document', key, err))));
    },
  };
}
