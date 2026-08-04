'use client';

/* Sign in / create account / reset password — email + password via Supabase,
   or Google. Four modes on one page. `recovery` isn't reachable from the links:
   Supabase's reset email brings the user back here with a recovery session, the
   auth listener sees the PASSWORD_RECOVERY event, and the form flips to
   "set a new password".

   Google needs no confirmation email — Google has already verified the address —
   so it lands the user straight in the app. */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../components/auth';
import { toast } from '../../components/toast';

type Mode = 'signin' | 'signup' | 'forgot' | 'recovery';

const COPY: Record<Mode, { title: string; sub: string; cta: string }> = {
  signin: { title: 'Sign in', sub: 'Your saved deals follow your account to any device.', cta: 'Sign in' },
  signup: { title: 'Create account', sub: 'Free. Deals saved on this device sync to the account the first time you sign in.', cta: 'Create account' },
  forgot: { title: 'Reset password', sub: 'We’ll email you a link that lets you set a new one.', cta: 'Send reset link' },
  recovery: { title: 'Set a new password', sub: 'You’re signed in through the reset link — pick the new password now.', cta: 'Update password' },
};

export default function LoginPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') setMode('recovery');
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!supabase) {
    return (
      <div className="auth-wrap">
        <div className="card auth-card">
          <h1>Accounts unavailable</h1>
          <p className="auth-sub">This build wasn&apos;t configured with a backend — everything still works, saved locally in this browser.</p>
        </div>
      </div>
    );
  }

  const switchMode = (m: Mode) => { setMode(m); setNotice(null); };

  /* Google sends the user back to /rental/, where the client picks the session
     out of the URL on load. The base path is whatever precedes /login/ — empty
     in dev, /real-estate-investor-toolkit on Pages — so this is derived rather
     than hardcoded, and the returned URL has to be on Supabase's allowlist. */
  async function signInWithGoogle() {
    if (busy || !supabase) return;
    setBusy(true);
    setNotice(null);
    const base = window.location.pathname.replace(/\/login\/?$/, '');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}${base}/rental/` },
    });
    /* on success the browser is already navigating to Google; only a failure
       comes back here */
    if (error) { setNotice({ kind: 'err', text: error.message }); setBusy(false); }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy || !supabase) return;
    setBusy(true);
    setNotice(null);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast('Signed in');
        router.push('/rental');
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) { toast('Account created'); router.push('/rental'); }
        else setNotice({ kind: 'ok', text: 'Almost there — click the confirmation link we just emailed you, then sign in.' });
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
        if (error) throw error;
        setNotice({ kind: 'ok', text: 'Reset link sent — check your email.' });
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast('Password updated');
        router.push('/rental');
      }
    } catch (e: any) {
      setNotice({ kind: 'err', text: e?.message || 'Something went wrong — try again.' });
    } finally {
      setBusy(false);
    }
  }

  const showEmail = mode !== 'recovery';
  const showPassword = mode !== 'forgot';
  const showGoogle = mode === 'signin' || mode === 'signup';
  const c = COPY[mode];

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <h1>{c.title}</h1>
        <p className="auth-sub">{c.sub}</p>

        {user && mode !== 'recovery' && (
          <div className="auth-notice ok">Already signed in as <b>{user.email}</b>.</div>
        )}

        {showGoogle && (
          <>
            <button type="button" className="auth-oauth" onClick={signInWithGoogle} disabled={busy}>
              <GoogleMark />
              Continue with Google
            </button>
            <div className="auth-or"><span>or</span></div>
          </>
        )}

        {showEmail && (
          <div className="auth-field">
            <label htmlFor="auth-email">Email</label>
            <input id="auth-email" type="email" required autoComplete="email"
              value={email} onChange={ev => setEmail(ev.target.value)}
              placeholder="you@example.com" />
          </div>
        )}
        {showPassword && (
          <div className="auth-field">
            <label htmlFor="auth-pass">{mode === 'recovery' ? 'New password' : 'Password'}</label>
            <input id="auth-pass" type="password" required minLength={8}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password} onChange={ev => setPassword(ev.target.value)}
              placeholder={mode === 'signin' ? 'Your password' : 'At least 8 characters'} />
          </div>
        )}

        {notice && <div className={`auth-notice ${notice.kind}`}>{notice.text}</div>}

        <button className="btn primary auth-cta" disabled={busy}>{busy ? 'Working…' : c.cta}</button>

        <div className="auth-alt">
          {mode === 'signin' && (
            <>
              <button type="button" onClick={() => switchMode('signup')}>New here? Create an account</button>
              <button type="button" onClick={() => switchMode('forgot')}>Forgot password</button>
            </>
          )}
          {mode === 'signup' && <button type="button" onClick={() => switchMode('signin')}>Have an account? Sign in</button>}
          {mode === 'forgot' && <button type="button" onClick={() => switchMode('signin')}>Back to sign in</button>}
        </div>
      </form>
      <p className="footnote auth-foot">No account needed to use the tools — signing in just backs your saved deals up to the cloud and syncs them across devices.</p>
    </div>
  );
}

/* Google's mark, inline — the app loads no third-party assets */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2.1 5-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.1z" />
      <path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.750H4.2v5.7C7.8 40.5 15.3 46 24 46z" />
      <path fill="#FBBC05" d="M11.6 27.45a13.2 13.2 0 0 1 0-8.9v-5.7H4.2a22 22 0 0 0 0 20.3l7.4-5.7z" />
      <path fill="#EA4335" d="M24 10.4c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 3.9 30 2 24 2 15.3 2 7.8 7.5 4.2 15.55l7.4 5.7C13.3 14.3 18.2 10.4 24 10.4z" />
    </svg>
  );
}
