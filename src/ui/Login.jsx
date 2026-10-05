import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { api } from '../lib/api.js';

export default function Login() {
  const { login, register } = useApp();
  const invite = new URLSearchParams(location.search).get('invite') || '';
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [signupOpen, setSignupOpen] = useState(true);
  const [inviteRequired, setInviteRequired] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState(invite);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // sign-up shows unless the server disabled it; ?invite=… links open it directly
  useEffect(() => {
    api.config().then((c) => {
      setSignupOpen(!!c.signup);
      setInviteRequired(!!c.inviteRequired);
      if (c.signup && invite) setMode('signup');
    }).catch(() => {});
    // eslint-disable-next-line
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      if (mode === 'signup') await register({ email: email.trim(), password, displayName: displayName.trim(), code: code.trim() });
      else await login(email.trim(), password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const switchTo = (m) => (e) => { e.preventDefault(); setError(''); setMode(m); };
  const signup = mode === 'signup';
  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <img className="auth-logo-img" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="Voxly" />
        <h1>{signup ? 'Create your account' : 'Welcome to Voxly'}</h1>
        <p className="auth-sub">
          {signup ? 'Just an email, a password and a username.' : 'Log in to chat, call and screenshare with friends.'}
        </p>
        {error && <div className="auth-error">{error}</div>}
        {signup && inviteRequired && (<>
          <label>Invite code</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} required placeholder="Ask your friend" />
        </>)}
        {signup && (<>
          <label>Username</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={32} placeholder="What friends see" />
        </>)}
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          autoFocus required placeholder="you@example.com" />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          required minLength={signup ? 6 : undefined} placeholder="••••••••" />
        <button className="btn-primary" disabled={busy}>
          {busy ? (signup ? 'Creating…' : 'Logging in…') : (signup ? 'Create Account' : 'Log In')}
        </button>
        <p className="auth-note">
          {!signupOpen ? 'No sign-up — accounts are created by the owner. Ask them for an invite.'
            : signup ? <>Already have an account? <a href="#" onClick={switchTo('login')}>Log in</a></>
            : <>New here? <a href="#" onClick={switchTo('signup')}>Create an account</a></>}
        </p>
      </form>
    </div>
  );
}
