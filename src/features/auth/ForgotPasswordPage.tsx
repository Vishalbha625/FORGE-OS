import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Field } from '../../components/ui';
import { resetPassword } from '../../lib/authService';
import { AuthShell, FormError } from './AuthShell';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await resetPassword(email);
    setBusy(false);
    if (res.success) setSentTo(email.trim().toLowerCase());
    else setError(res.error ?? 'Could not send the reset link.');
  };

  if (sentTo) {
    return (
      <AuthShell title="Check your email" lead={<>We sent a password reset link to <span className="highlight">{sentTo}</span>.</>}>
        <Link to="/login" className="btn-outline w-full">Back to sign in</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" lead="Enter your account email and we'll send you a link to set a new password.">
      <form onSubmit={submit} noValidate>
        <Field label="Email">
          <input className="field" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <FormError message={error} />
        <button type="submit" className="btn-solid w-full" disabled={busy || !email.trim()}>
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <p className="mt-6 text-center"><Link to="/login" className="link">Back to sign in</Link></p>
    </AuthShell>
  );
}
