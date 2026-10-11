import { useEffect, useState } from 'react';
import { api, clearToken, getToken, saveToken } from './session.js';
import Overview from './pages/Overview.jsx';
import Drivers from './pages/Drivers.jsx';
import Trips from './pages/Trips.jsx';
import Money from './pages/Money.jsx';

const PAGES = [
  { key: 'overview', label: 'Overview', Page: Overview },
  { key: 'drivers', label: 'Drivers', Page: Drivers },
  { key: 'trips', label: 'Trips', Page: Trips },
  { key: 'money', label: 'Money', Page: Money },
];

const COUNTRIES = [
  { value: '', label: 'All countries' },
  { value: 'GH', label: 'Ghana' },
  { value: 'DE', label: 'Germany' },
];

export default function App() {
  const [user, setUser] = useState(undefined);
  const [page, setPage] = useState(() => location.hash.slice(1) || 'overview');
  const [country, setCountry] = useState('');

  useEffect(() => {
    if (!getToken()) return setUser(null);
    api.me().then(({ user: me }) => setUser(me.role === 'admin' ? me : null)).catch(() => setUser(null));
  }, []);
  useEffect(() => { location.hash = page; }, [page]);

  const signOut = () => { clearToken(); setUser(null); };

  if (user === undefined) return <main className="center">Loading…</main>;
  if (!user) return <SignIn onSignedIn={setUser} />;

  const { Page } = PAGES.find((p) => p.key === page) ?? PAGES[0];
  return (
    <div className="shell">
      <header className="topbar">
        <strong className="brand">Pick Admin</strong>
        <nav>
          {PAGES.map((p) => (
            <button key={p.key} className={p.key === page ? 'tab on' : 'tab'} onClick={() => setPage(p.key)}>{p.label}</button>
          ))}
        </nav>
        <div className="topbar-end">
          <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country">
            {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <button className="link" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main><Page country={country || undefined} /></main>
    </div>
  );
}

function SignIn({ onSignedIn }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!sent) {
        await api.requestCode(phone.trim());
        setSent(true);
      } else {
        const { token, user } = await api.verify(phone.trim(), code.trim());
        if (user.role !== 'admin') throw new Error('This number has no admin account.');
        saveToken(token);
        onSignedIn(user);
      }
    } catch (err) {
      // New numbers get "role must be ..." from the API: they aren't admins either.
      setError(err.status === 400 && /role/.test(err.message) ? 'This number has no admin account.' : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="center">
      <form className="card signin" onSubmit={submit}>
        <h1>Pick Admin</h1>
        <label>Mobile number
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+233 24 123 4567" disabled={sent} autoFocus />
        </label>
        {sent && (
          <label>Code we texted you
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} autoFocus />
          </label>
        )}
        <button className="primary" disabled={busy}>{sent ? 'Sign in' : 'Send code'}</button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
