import { useState } from 'react';
import { api } from '../session.js';
import { useLoad } from '../useLoad.js';
import { describeBalance, formatDateTime } from '../format.js';
import DriverDocuments from './DriverDocuments.jsx';

const FILTERS = [{ value: 'pending', label: 'Waiting for approval' }, { value: 'approved', label: 'Approved' }, { value: 'all', label: 'All' }];

export default function Drivers({ country }) {
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [documentsFor, setDocumentsFor] = useState(null);
  const { data, error, reload } = useLoad(() => api.drivers({ status, q: search, country }), [status, search, country]);

  const setApproval = async (driver, approved) => {
    if (!approved && !confirm(`Suspend ${driver.name ?? driver.phone}? They'll be taken offline and can't drive until approved again.`)) return;
    setBusy(driver.id);
    setActionError(null);
    try {
      await api.setApproval(driver.id, approved);
      await reload();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <div className="row">
        <h2>Drivers</h2>
        <form className="search" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or plate" />
          <button>Search</button>
        </form>
      </div>
      <div className="segmented">
        {FILTERS.map((f) => (
          <button key={f.value} className={f.value === status ? 'on' : ''} onClick={() => setStatus(f.value)}>{f.label}</button>
        ))}
      </div>
      {(error || actionError) && <p className="error">{error || actionError}</p>}
      {data?.drivers.length === 0 && <p className="muted">No drivers here.</p>}
      {data?.drivers.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Driver</th><th>Car</th><th>Documents</th><th>Joined</th><th>Rides</th><th>Balance</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {data.drivers.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.name ?? 'No name'}</strong><div className="muted">{d.phone} · {d.country}</div></td>
                  <td>{[d.vehicleMake, d.vehiclePlate].filter(Boolean).join(' · ') || <span className="muted">Not added</span>}
                    <div className="muted">{d.seats} seats</div></td>
                  <td>
                    <button className="link-strong" onClick={() => setDocumentsFor(d)}>
                      {d.documentsApproved} of {d.documentsRequired} approved
                    </button>
                    {d.documentsPending > 0 && <div><span className="pill warn">{d.documentsPending} to check</span></div>}
                  </td>
                  <td>{formatDateTime(d.joinedAt)}</td>
                  <td>{d.rides}</td>
                  <td>{d.currency ? describeBalance(d.balance, d.currency) : '—'}</td>
                  <td>{d.approved ? (d.online ? <span className="pill ok">Online</span> : 'Approved') : <span className="pill warn">Waiting</span>}</td>
                  <td className="actions">
                    {d.approved
                      ? <button onClick={() => setApproval(d, false)} disabled={busy === d.id}>Suspend</button>
                      : <button className="primary" onClick={() => setApproval(d, true)} disabled={busy === d.id || !d.vehiclePlate}
                          title={d.vehiclePlate ? '' : 'The driver needs to add their car first'}>Approve</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {documentsFor && <DriverDocuments driver={documentsFor} onClose={() => setDocumentsFor(null)} onChanged={reload} />}
      <p className="muted small">Approve a driver once their documents are approved. Drivers upload them in the app.</p>
    </section>
  );
}
