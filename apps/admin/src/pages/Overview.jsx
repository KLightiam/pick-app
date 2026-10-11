import { useState } from 'react';
import { api } from '../session.js';
import { useLoad } from '../useLoad.js';
import { STATUS_LABELS, formatMoney } from '../format.js';

const PERIODS = [{ days: 1, label: 'Today' }, { days: 7, label: '7 days' }, { days: 30, label: '30 days' }];

export default function Overview({ country }) {
  const [days, setDays] = useState(1);
  const { data, error } = useLoad(() => api.overview({ days, country }), [days, country]);

  return (
    <section>
      <div className="row">
        <h2>Overview</h2>
        <div className="segmented">
          {PERIODS.map((p) => (
            <button key={p.days} className={p.days === days ? 'on' : ''} onClick={() => setDays(p.days)}>{p.label}</button>
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <div className="stats">
            <Stat label="Drivers waiting for approval" value={data.drivers.pending} warn={data.drivers.pending > 0} />
            <Stat label="Drivers online now" value={data.drivers.online} />
            <Stat label="Approved drivers" value={data.drivers.approved} />
            <Stat label="Riders" value={data.riders} />
          </div>
          <h3>Trips</h3>
          <div className="stats">
            {Object.keys(STATUS_LABELS).map((s) => <Stat key={s} label={STATUS_LABELS[s]} value={data.trips[s] ?? 0} />)}
          </div>
          <h3>Money</h3>
          {data.money.length === 0 && <p className="muted">No completed rides in this period.</p>}
          {data.money.map((m) => (
            <div className="stats" key={m.currency}>
              <Stat label={`Fares (${m.rides} rides)`} value={formatMoney(m.fares, m.currency)} />
              <Stat label="Pick's commission" value={formatMoney(m.commission, m.currency)} />
              <Stat label="Paid in cash" value={formatMoney(m.cash, m.currency)} />
              <Stat label="Paid in the app" value={formatMoney(m.appPaid, m.currency)} />
              <Stat label="Not paid yet" value={formatMoney(m.appUnpaid, m.currency)} warn={m.appUnpaid > 0} />
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, warn }) {
  return (
    <div className={warn ? 'stat warn' : 'stat'}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
