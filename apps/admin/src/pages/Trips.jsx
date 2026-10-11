import { useEffect, useState } from 'react';
import { api } from '../session.js';
import { STATUS_LABELS, describePayment, formatDateTime, formatMoney } from '../format.js';

export default function Trips({ country }) {
  const [status, setStatus] = useState('');
  const [trips, setTrips] = useState([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(null);

  const load = async (before) => {
    setError(null);
    try {
      const { trips: page } = await api.trips({ status: status || undefined, country, before });
      setTrips((list) => (before ? [...list, ...page] : page));
      setMore(page.length === 50);
    } catch (err) {
      setError(err.message);
    }
  };
  useEffect(() => { load(); }, [status, country]);

  return (
    <section>
      <div className="row">
        <h2>Trips</h2>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {trips.length === 0 && !error && <p className="muted">No trips.</p>}
      {trips.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>When</th><th>Rider</th><th>Driver</th><th>Route</th><th>Ride</th><th>Fare</th><th>Payment</th><th>Status</th></tr>
            </thead>
            <tbody>
              {trips.map((t) => (
                <tr key={t.id}>
                  <td>{formatDateTime(t.requestedAt)}</td>
                  <td>{t.rider.name ?? '—'}<div className="muted">{t.rider.phone}</div></td>
                  <td>{t.driver ? <>{t.driver.name ?? '—'}<div className="muted">{t.driver.phone}</div></> : <span className="muted">None</span>}</td>
                  <td>{t.pickupAddress ?? 'Pin'} → {t.dropoffAddress ?? 'Pin'}</td>
                  <td>{t.rideType === 'shared' ? 'Shared' : 'Solo'} · {t.driverMode === 'commute' ? 'Commuter' : 'Go-anywhere'}</td>
                  <td>{t.fareFinal !== null ? formatMoney(t.fareFinal, t.currency) : <span className="muted">up to {formatMoney(t.fareEstimate, t.currency)}</span>}</td>
                  <td>{describePayment(t)}</td>
                  <td>{STATUS_LABELS[t.status]}{t.cancelledBy && <div className="muted">by {t.cancelledBy}{t.cancelReason ? `: ${t.cancelReason}` : ''}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && <button onClick={() => load(trips.at(-1).requestedAt)}>Show older trips</button>}
    </section>
  );
}
