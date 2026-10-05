import { useState } from 'react';
import { useApp } from '../state/AppContext.jsx';

export default function Login() {
  const { login } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <img className="auth-logo-img" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="Voxly" />
        <h1>Welcome to Voxly</h1>
        <p className="auth-sub">Invite-only — log in with the account you were given.</p>
        {error && <div className="auth-error">{error}</div>}
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          autoFocus required placeholder="you@example.com" />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          required placeholder="••••••••" />
        <button className="btn-primary" disabled={busy}>{busy ? 'Logging in…' : 'Log In'}</button>
        <p className="auth-note">
          No sign-up — accounts are created by the owner. Ask them for an invite.
        </p>
      </form>
    </div>
  );
}
