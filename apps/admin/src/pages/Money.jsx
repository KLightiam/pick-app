import { useState } from 'react';
import { api } from '../session.js';
import { useLoad } from '../useLoad.js';
import { describeBalance, formatDateTime, formatMoney, parseMoney } from '../format.js';

export default function Money({ country }) {
  const balances = useLoad(() => api.balances({ country }), [country]);
  const history = useLoad(() => api.settlements(), []);
  const [settling, setSettling] = useState(null);

  const done = () => { setSettling(null); balances.reload(); history.reload(); };

  return (
    <section>
      <h2>Money to settle</h2>
      <p className="muted">
        Pick holds what riders pay in the app and owes it to the driver. On cash rides the driver holds the fare and owes Pick its commission.
        Until automatic payouts, send money by MoMo or bank transfer and record it here.
      </p>
      {balances.error && <p className="error">{balances.error}</p>}
      {balances.data?.balances.length === 0 && <p className="muted">Every driver is settled.</p>}
      {balances.data?.balances.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Driver</th><th>Rides</th><th>App earnings</th><th>Commission on cash</th><th>Settled</th><th>Balance</th><th /></tr>
            </thead>
            <tbody>
              {balances.data.balances.map((b) => (
                <tr key={b.driverId}>
                  <td><strong>{b.name ?? '—'}</strong><div className="muted">{b.phone}</div></td>
                  <td>{b.rides}</td>
                  <td>{formatMoney(b.owedToDriver, b.currency)}</td>
                  <td>{formatMoney(b.commissionOnCash, b.currency)}</td>
                  <td className="muted">paid {formatMoney(b.paidToDriver, b.currency)} · received {formatMoney(b.paidByDriver, b.currency)}</td>
                  <td><strong>{describeBalance(b.balance, b.currency)}</strong></td>
                  <td className="actions"><button className="primary" onClick={() => setSettling(b)}>Record</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {settling && <SettleForm balance={settling} onDone={done} onCancel={() => setSettling(null)} />}

      <h3>Recorded settlements</h3>
      {history.data?.settlements.length === 0 && <p className="muted">None yet.</p>}
      {history.data?.settlements.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Driver</th><th>Direction</th><th>Amount</th><th>Reference</th><th>Recorded by</th></tr></thead>
            <tbody>
              {history.data.settlements.map((s) => (
                <tr key={s.id}>
                  <td>{formatDateTime(s.createdAt)}</td>
                  <td>{s.driverName ?? '—'}</td>
                  <td>{s.direction === 'to_driver' ? 'Paid to driver' : 'Received from driver'}</td>
                  <td>{formatMoney(s.amount, s.currency)}</td>
                  <td>{s.reference ?? ''}{s.note && <div className="muted">{s.note}</div>}</td>
                  <td>{s.recordedBy ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SettleForm({ balance, onDone, onCancel }) {
  const toDriver = balance.balance > 0;
  const [amount, setAmount] = useState((Math.abs(balance.balance) / 100).toFixed(2));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const minor = parseMoney(amount);
    if (!minor) return setError('Enter an amount, like 24.11');
    setBusy(true);
    setError(null);
    try {
      await api.recordSettlement({
        driverId: balance.driverId,
        direction: toDriver ? 'to_driver' : 'from_driver',
        amount: minor,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card settle" onSubmit={submit}>
      <h3>{toDriver ? `Record a payment to ${balance.name ?? 'the driver'}` : `Record money received from ${balance.name ?? 'the driver'}`}</h3>
      <label>Amount ({balance.currency})<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label>
      <label>Reference<input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="MoMo or bank transaction ID" /></label>
      <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></label>
      <div className="row-start">
        <button className="primary" disabled={busy}>Save</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
