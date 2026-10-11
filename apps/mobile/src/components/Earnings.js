import { useEffect, useState } from 'react';
import { api } from '../api-instance.js';
import { formatMoney } from '../format.js';
import { Body, Card } from '../ui.js';

/** The driver's last 7 days of rides and money, and where they stand with Pick overall. */
export default function Earnings() {
  const [earnings, setEarnings] = useState(null);
  useEffect(() => { api.earnings(7).then(setEarnings).catch(() => {}); }, []);
  if (!earnings || earnings.rides.length === 0) return null;

  const money = (minor) => formatMoney(Math.abs(minor), earnings.currency);
  const earned = earnings.rides.reduce((sum, r) => sum + r.earned, 0);
  const cash = earnings.rides.filter((r) => r.method === 'cash').reduce((sum, r) => sum + r.amount, 0);
  const { balance } = earnings.balance;
  return (
    <Card>
      <Body style={{ fontWeight: '600' }}>Last 7 days</Body>
      <Body>{earnings.rides.length} {earnings.rides.length === 1 ? 'ride' : 'rides'} · you earned {money(earned)}</Body>
      {cash > 0 && <Body muted>{money(cash)} collected in cash</Body>}
      <Body muted>
        {balance >= 0
          ? `Pick owes you ${money(balance)}`
          : `You owe Pick ${money(balance)} in commission on cash rides`}
      </Body>
    </Card>
  );
}
