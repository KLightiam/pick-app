import { useEffect, useState } from 'react';
import { api } from '../api-instance.js';
import { formatMoney } from '../format.js';
import { Body, Card } from '../ui.js';

/** The driver's last 7 days: rides, money collected, and where they stand with Pick. */
export default function Earnings() {
  const [earnings, setEarnings] = useState(null);
  useEffect(() => { api.earnings(7).then(setEarnings).catch(() => {}); }, []);
  if (!earnings || earnings.rides.length === 0) return null;

  const money = (minor) => formatMoney(Math.abs(minor), earnings.currency);
  const earned = earnings.rides.reduce((sum, r) => sum + r.earned, 0);
  return (
    <Card>
      <Body style={{ fontWeight: '600' }}>Last 7 days</Body>
      <Body>{earnings.rides.length} {earnings.rides.length === 1 ? 'ride' : 'rides'} · you earned {money(earned)}</Body>
      {earnings.cashCollected > 0 && <Body muted>{money(earnings.cashCollected)} collected in cash</Body>}
      <Body muted>
        {earnings.balance >= 0
          ? `Pick owes you ${money(earnings.balance)} from app payments`
          : `You owe Pick ${money(earnings.balance)} commission on cash rides`}
      </Body>
    </Card>
  );
}
