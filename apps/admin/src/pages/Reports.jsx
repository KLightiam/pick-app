import { useState } from 'react';
import { api } from '../session.js';
import { useLoad } from '../useLoad.js';
import { REPORT_LABELS, formatDateTime, phoneLabel } from '../format.js';

const FILTERS = [{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }];
const ROLES = { rider: 'Rider', driver: 'Driver' };

const person = (p) => (p ? <>{p.name ?? 'No name'} <span className="muted">({ROLES[p.role] ?? p.role})</span><div className="muted">{phoneLabel(p.phone)}</div></> : '—');

export default function Reports({ country }) {
  const [status, setStatus] = useState('open');
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const { data, error, reload } = useLoad(() => api.reports({ status, country }), [status, country]);

  const resolve = async (report) => {
    const note = prompt('What was done about it? (optional)');
    if (note === null) return;
    setBusy(report.id);
    setActionError(null);
    try {
      await api.resolveReport(report.id, note.trim() || undefined);
      await reload();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <div className="row"><h2>Reports</h2></div>
      <div className="segmented">
        {FILTERS.map((f) => (
          <button key={f.value} className={f.value === status ? 'on' : ''} onClick={() => setStatus(f.value)}>{f.label}</button>
        ))}
      </div>
      {(error || actionError) && <p className="error">{error || actionError}</p>}
      {data?.reports.length === 0 && <p className="muted">{status === 'open' ? 'Nothing to follow up.' : 'No resolved reports yet.'}</p>}
      {data?.reports.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Reported</th><th>Problem</th><th>From</th><th>About</th><th>Trip</th><th>{status === 'open' ? '' : 'Resolved'}</th></tr>
            </thead>
            <tbody>
              {data.reports.map((r) => (
                <tr key={r.id}>
                  <td>{formatDateTime(r.createdAt)}</td>
                  <td>
                    {r.category === 'safety'
                      ? <span className="pill bad">{REPORT_LABELS.safety}</span>
                      : <strong>{REPORT_LABELS[r.category] ?? r.category}</strong>}
                    {r.details && <div className="details">{r.details}</div>}
                  </td>
                  <td>{person(r.reporter)}</td>
                  <td>{person(r.aboutUser)}</td>
                  <td>{r.pickupAddress ?? 'Pin'} → {r.dropoffAddress ?? 'Pin'}<div className="muted">{formatDateTime(r.tripAt)}</div></td>
                  <td className={r.status === 'open' ? 'actions' : ''}>
                    {r.status === 'open'
                      ? <button className="primary" onClick={() => resolve(r)} disabled={busy === r.id}>Mark resolved</button>
                      : <>{formatDateTime(r.resolvedAt)} by {r.resolvedBy ?? '—'}{r.resolutionNote && <div className="muted">{r.resolutionNote}</div>}</>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">Riders and drivers report problems from the trip screen in the app. Safety reports come first.</p>
    </section>
  );
}
