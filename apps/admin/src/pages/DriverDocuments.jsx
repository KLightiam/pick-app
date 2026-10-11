import { useEffect, useState } from 'react';
import { api } from '../session.js';
import { useLoad } from '../useLoad.js';
import { formatDateTime } from '../format.js';

const STATUS = { pending: 'To check', approved: 'Approved', rejected: 'Rejected' };

/** One driver's documents: view each upload, approve it, or reject it with a reason the driver sees. */
export default function DriverDocuments({ driver, onClose, onChanged }) {
  const { data, error, reload } = useLoad(() => api.driverDocuments(driver.id), [driver.id]);
  const [viewing, setViewing] = useState(null);
  const [actionError, setActionError] = useState(null);

  const review = async (doc, status) => {
    let reason;
    if (status === 'rejected') {
      reason = prompt('Why is this document not accepted? The driver will see this.');
      if (!reason?.trim()) return;
    }
    setActionError(null);
    try {
      await api.reviewDocument(doc.id, status, reason);
      await reload();
      onChanged();
    } catch (err) {
      setActionError(err.message);
    }
  };

  return (
    <div className="card documents">
      <div className="row">
        <h3>Documents: {driver.name ?? driver.phone}</h3>
        <button onClick={onClose}>Close</button>
      </div>
      {(error || actionError) && <p className="error">{error || actionError}</p>}
      {data && (
        <div className="doc-list">
          {data.checklist.map(({ kind, label, document }) => (
            <div key={kind} className="doc">
              <div>
                <strong>{label}</strong>
                <div className="muted">
                  {document ? `${STATUS[document.status]} · uploaded ${formatDateTime(document.uploadedAt)}` : 'Not uploaded yet'}
                  {document?.rejectReason && ` · "${document.rejectReason}"`}
                </div>
              </div>
              {document && (
                <div className="actions">
                  <button onClick={() => setViewing(document)}>View</button>
                  {document.status === 'pending' && (
                    <>
                      <button className="primary" onClick={() => review(document, 'approved')}>Approve</button>
                      <button onClick={() => review(document, 'rejected')}>Reject</button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {viewing && <DocumentViewer document={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function DocumentViewer({ document, onClose }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let objectUrl;
    api.documentFile(document.id)
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); })
      .catch((err) => setError(err.message));
    return () => objectUrl && URL.revokeObjectURL(objectUrl);
  }, [document.id]);

  return (
    <div className="viewer">
      <div className="row">
        <span className="muted">{document.contentType} · {Math.round(document.sizeBytes / 1024)} KB</span>
        <button onClick={onClose}>Close</button>
      </div>
      {error && <p className="error">{error}</p>}
      {url && (document.contentType === 'application/pdf'
        ? <a href={url} target="_blank" rel="noreferrer">Open the PDF</a>
        : <img src={url} alt="Uploaded document" />)}
    </div>
  );
}
