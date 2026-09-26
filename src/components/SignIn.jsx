import { useState } from 'react';
import { signInWithPopup, signInWithRedirect } from 'firebase/auth';
import { auth, googleProvider } from '../firebase.js';

export default function SignIn({ error }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function go() {
    setBusy(true);
    setErr('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      const popupIssue =
        e.code === 'auth/popup-blocked' ||
        e.code === 'auth/operation-not-supported-in-this-environment' ||
        e.code === 'auth/cancelled-popup-request';
      if (popupIssue) {
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (e2) {
          setErr(e2.message || 'Sign-in failed.');
        }
      } else if (e.code !== 'auth/popup-closed-by-user') {
        setErr(e.message || 'Sign-in failed.');
      }
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <div className="signin-card">
        <img src="/icon.svg" alt="" width="72" height="72" />
        <h1>Site Visit Planner</h1>
        <p>
          All your upcoming site visits on one map, so you can schedule the next
          one geographically intelligently.
        </p>
        <button className="btn btn-primary btn-lg" onClick={go} disabled={busy}>
          {busy ? 'Opening…' : 'Continue with Google'}
        </button>
        {(err || error) && <p className="hint hint-err">{err || error}</p>}
        <a className="signin-demo" href="?demo=1">
          …or explore the demo first
        </a>
      </div>
    </div>
  );
}
