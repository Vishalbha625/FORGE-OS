import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Check, Circle } from 'lucide-react';
import { Field } from '../../components/ui';
import { checkPassword, isPasswordValid, notifyAuthLinked, signInWithGoogle, signUpWithEmail } from '../../lib/authService';
import { AuthShell, FormError } from './AuthShell';

function Requirement({ met, children }: { met: boolean; children: string }) {
  const Icon = met ? Check : Circle;
  return (
    <li className={`flex items-center gap-1.5 transition-colors ${met ? 'text-good' : 'text-muted'}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span>{children}</span>
      <span className="sr-only">{met ? '(done)' : '(not yet)'}</span>
    </li>
  );
}

export function SignUpPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);
  const checks = checkPassword(password);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await signUpWithEmail(email, password, name);
    setBusy(false);
    if (!res.success || !res.user) {
      setError(res.error ?? 'Could not create the account.');
      return;
    }
    notifyAuthLinked(res.user.id);
    // With email confirmation on there is no session yet: ask them to confirm first.
    if (!res.session) {
      setConfirmEmail(email.trim().toLowerCase());
      return;
    }
    navigate('/community', { replace: true });
  };

  const google = async () => {
    setError(null);
    const res = await signInWithGoogle();
    if (!res.success) setError(res.error ?? 'Could not start Google sign-up.');
  };

  if (confirmEmail) {
    return (
      <AuthShell title="Check your email" lead={<>We sent a confirmation link to <span className="highlight">{confirmEmail}</span>. Open it on this device to finish.</>}>
        <Link to="/login" state={location.state} className="btn-outline w-full">Back to sign in</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account" lead={<>Your health data stays on your device. <span className="highlight">Only your posts are shared.</span></>}>
      <form onSubmit={submit} noValidate>
        <Field label="Display name">
          <input className="field" autoComplete="name" maxLength={60} required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email">
          <input className="field" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <label className="mb-4 block">
          <span className="label">Password</span>
          <input className="field" type="password" autoComplete="new-password" required aria-describedby="password-rules" value={password} onChange={(e) => setPassword(e.target.value)} />
          <ul id="password-rules" className="mt-2 space-y-1 text-xs">
            <Requirement met={checks.length}>At least 8 characters</Requirement>
            <Requirement met={checks.letter}>Contains a letter</Requirement>
            <Requirement met={checks.number}>Contains a number</Requirement>
          </ul>
        </label>
        <FormError message={error} />
        <button type="submit" className="btn-solid w-full" disabled={busy || !isPasswordValid(password) || !name.trim() || !email.trim()}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <button type="button" className="btn-outline mt-3 w-full" onClick={google} disabled={busy}>Sign up with Google</button>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account? <Link to="/login" state={location.state} className="link">Sign in</Link>
      </p>
    </AuthShell>
  );
}
