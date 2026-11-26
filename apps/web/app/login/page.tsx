'use client';

/* Sign in, create an account, or reset a password: Google, or email and
   password with a verification email. Built from shadcn pieces.

   Five modes on one page. Two are not reachable from the links:
   · `verify` follows creating an account. The address has to be confirmed
     from the email before the account can sign in, and the link can be sent
     again from here.
   · `recovery` follows a password reset email. Supabase brings the user back
     with a recovery session, the auth listener sees PASSWORD_RECOVERY, and
     the form flips to "set a new password".

   Google needs no verification email, because Google has already verified the
   address. Every link Supabase emails or redirects to is told to come back to
   the origin the page is on, so it works on the live domain and in dev alike;
   each of those URLs has to be on the project's redirect allowlist. */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../components/auth';
import { toast } from '../../components/toast';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Icon } from '../../components/Icon';
import { cn } from '@/lib/utils';

type Mode = 'signin' | 'signup' | 'verify' | 'forgot' | 'recovery';

const COPY: Record<Mode, { title: string; sub: string; cta: string }> = {
  signin: { title: 'Sign in', sub: 'Your saved deals follow your account to any device.', cta: 'Sign in' },
  signup: { title: 'Create account', sub: 'Free. Deals saved on this device sync to the account the first time you sign in.', cta: 'Create account' },
  verify: { title: 'Check your email', sub: '', cta: 'I have confirmed it. Sign in' },
  forgot: { title: 'Reset password', sub: 'We will email you a link that lets you set a new one.', cta: 'Send reset link' },
  recovery: { title: 'Set a new password', sub: 'You are signed in through the reset link. Pick the new password now.', cta: 'Update password' },
};

/** Supabase's wording, turned into something a person can act on. */
function explain(e: any): string {
  const m = String(e?.message || '');
  if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Could not reach the sign-in service. Check your connection and try again in a minute.';
  if (/invalid login credentials/i.test(m)) return 'That email and password do not match an account.';
  if (/already registered|already exists/i.test(m)) return 'There is already an account for that email. Sign in, or reset the password.';
  if (/rate limit|too many/i.test(m)) return 'Too many tries. Wait a minute, then try again.';
  if (/provider is not enabled|unsupported provider/i.test(m)) return 'Google sign-in is not switched on for this site yet.';
  return m || 'Something went wrong. Try again.';
}

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

  /* a confirmation or Google link that failed comes back with the reason in the URL */
  useEffect(() => {
    const p = new URLSearchParams(window.location.hash.replace(/^#/, '') || window.location.search);
    const why = p.get('error_description');
    if (why) setNotice({ kind: 'err', text: /expired|invalid/i.test(why) ? 'That link has expired or was already used. Ask for a new one below.' : why.replace(/\+/g, ' ') });
  }, []);

  if (!supabase) {
    return (
      <div className="mx-auto mt-8 max-w-[400px]">
        <Card className="gap-2 p-6">
          <h1 className="text-xl font-extrabold text-ink-strong">Accounts unavailable</h1>
          <p className="text-[0.9375rem] leading-snug text-muted-foreground">This build was not set up with a backend. Everything still works, saved in this browser.</p>
        </Card>
      </div>
    );
  }

  const switchMode = (m: Mode) => { setMode(m); setNotice(null); };
  /* where emailed links and Google bring the user back: this site, wherever it is served */
  const here = (path: string) => `${window.location.origin}${window.location.pathname.replace(/\/login\/?$/, '')}${path}`;

  async function signInWithGoogle() {
    if (busy || !supabase) return;
    setBusy(true);
    setNotice(null);
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: here('/rental/') } });
    /* on success the browser is already on its way to Google; only a failure comes back here */
    if (error) { setNotice({ kind: 'err', text: explain(error) }); setBusy(false); }
  }

  async function resend() {
    if (busy || !supabase || !email) return;
    setBusy(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: here('/login/') } });
    setNotice(error ? { kind: 'err', text: explain(error) } : { kind: 'ok', text: `Sent again to ${email}. It can take a minute, and may land in spam.` });
    setBusy(false);
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy || !supabase) return;
    setBusy(true);
    setNotice(null);
    try {
      if (mode === 'signin' || mode === 'verify') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          if (/not confirmed/i.test(error.message)) {
            setMode('verify');
            setNotice({ kind: 'err', text: 'That email is not confirmed yet. Click the link we sent you, or send it again.' });
            return;
          }
          throw error;
        }
        toast('Signed in');
        router.push('/rental');
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: here('/login/') } });
        if (error) throw error;
        /* Supabase answers an existing address with a user that has no identities, to avoid leaking who has an account */
        if (data.user && data.user.identities && data.user.identities.length === 0) throw new Error('already registered');
        if (data.session) { toast('Account created'); router.push('/rental'); }
        else setMode('verify');
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: here('/login/') });
        if (error) throw error;
        setNotice({ kind: 'ok', text: 'Reset link sent. Check your email.' });
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast('Password updated');
        router.push('/rental');
      }
    } catch (e: any) {
      setNotice({ kind: 'err', text: explain(e) });
    } finally {
      setBusy(false);
    }
  }

  const showEmail = mode === 'signin' || mode === 'signup' || mode === 'forgot';
  const showPassword = mode === 'signin' || mode === 'signup' || mode === 'recovery';
  const showGoogle = mode === 'signin' || mode === 'signup';
  const c = COPY[mode];
  const label = 'mb-1 block text-sm font-semibold text-ink-strong';
  const link = 'text-sm font-semibold text-primary hover:text-primary-hover hover:underline';

  return (
    <div className="mx-auto mt-4 max-w-[400px] min-[900px]:mt-8">
      <Card className="gap-0 p-6">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <h1 className="text-xl font-extrabold text-ink-strong">{c.title}</h1>
            <p className="mt-1 text-[0.9375rem] leading-snug text-muted-foreground">
              {mode === 'verify'
                ? <>We sent a confirmation link to <b className="text-ink-strong">{email}</b>. Click it to finish creating your account, then sign in here.</>
                : c.sub}
            </p>
          </div>

          {user && mode !== 'recovery' && (
            <p className="rounded-md bg-success-soft px-3 py-2 text-sm text-ink-strong">Already signed in as <b>{user.email}</b>.</p>
          )}

          {showGoogle && (
            <>
              <Button type="button" variant="outline" className="w-full" onClick={signInWithGoogle} disabled={busy}>
                <GoogleMark />Continue with Google
              </Button>
              <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
              </div>
            </>
          )}

          {showEmail && (
            <div>
              <label htmlFor="auth-email" className={label}>Email</label>
              <Input id="auth-email" type="email" required autoComplete="email" className="h-10" placeholder="you@example.com"
                value={email} onChange={ev => setEmail(ev.target.value)} />
            </div>
          )}
          {showPassword && (
            <div>
              <label htmlFor="auth-pass" className={label}>{mode === 'recovery' ? 'New password' : 'Password'}</label>
              <Input id="auth-pass" type="password" required minLength={8} className="h-10"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                placeholder={mode === 'signin' ? 'Your password' : 'At least 8 characters'}
                value={password} onChange={ev => setPassword(ev.target.value)} />
              {mode === 'signup' && <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">We will email you a link to confirm the address before you can sign in.</p>}
            </div>
          )}

          {notice && (
            <p role={notice.kind === 'err' ? 'alert' : 'status'}
              className={cn('flex items-start gap-2 rounded-md px-3 py-2 text-sm leading-snug text-ink-strong', notice.kind === 'err' ? 'bg-destructive-soft' : 'bg-success-soft')}>
              <Icon name={notice.kind === 'err' ? 'error' : 'check_circle'} size={18} className={cn('mt-px shrink-0', notice.kind === 'err' ? 'text-destructive' : 'text-success')} />
              {notice.text}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Working…' : c.cta}</Button>

          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
            {mode === 'signin' && <>
              <button type="button" className={link} onClick={() => switchMode('signup')}>New here? Create an account</button>
              <button type="button" className={link} onClick={() => switchMode('forgot')}>Forgot password</button>
            </>}
            {mode === 'signup' && <button type="button" className={link} onClick={() => switchMode('signin')}>Have an account? Sign in</button>}
            {mode === 'verify' && <>
              <button type="button" className={link} onClick={resend} disabled={busy}>Send the link again</button>
              <button type="button" className={link} onClick={() => switchMode('signup')}>Use a different email</button>
            </>}
            {mode === 'forgot' && <button type="button" className={link} onClick={() => switchMode('signin')}>Back to sign in</button>}
          </div>
        </form>
      </Card>
      <p className="mt-3 px-1 text-[0.8125rem] leading-snug text-muted-foreground">
        No account is needed to use the tools. Signing in backs your saved deals up and syncs them across devices.
      </p>
    </div>
  );
}

/* Google's mark, inline: the app loads no third-party assets */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2.1 5-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.1z" />
      <path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.2H4.2v5.7C7.8 40.5 15.3 46 24 46z" />
      <path fill="#FBBC05" d="M11.6 28a13.2 13.2 0 0 1 0-8v-5.7H4.2a22 22 0 0 0 0 19.4l7.4-5.7z" />
      <path fill="#EA4335" d="M24 10.4c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 3.9 30 2 24 2 15.3 2 7.8 7.5 4.2 14.3l7.4 5.7C13.3 14.3 18.2 10.4 24 10.4z" />
    </svg>
  );
}
