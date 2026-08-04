'use client';

/* Sign in / create account / reset password — email + password via Supabase.
   Four modes on one page. `recovery` isn't reachable from the links: Supabase's
   reset email brings the user back here with a recovery session, the auth
   listener sees the PASSWORD_RECOVERY event, and the form flips to
   "set a new password". */

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
  const c = COPY[mode];

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <h1>{c.title}</h1>
        <p className="auth-sub">{c.sub}</p>

        {user && mode !== 'recovery' && (
          <div className="auth-notice ok">Already signed in as <b>{user.email}</b>.</div>
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
