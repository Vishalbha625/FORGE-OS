import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Field } from '../../components/ui';
import { useAuth } from '../../store/AuthContext';
import { isPasswordValid, updatePassword } from '../../lib/authService';
import { useToast } from '../../store/toast';
import { AuthShell, FormError } from './AuthShell';

/** Opened from the reset email. The link signs the user in; here they choose a new password. */
export function ResetPasswordPage() {
  const { isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) {
    return <AuthShell title="Checking your link…"><p className="text-sm text-muted motion-safe:animate-pulse" role="status">One moment.</p></AuthShell>;
  }
  if (!isAuthenticated) {
    return (
      <AuthShell title="This link has expired" lead="Reset links work once, in the browser that asked for them. Request a new one.">
        <Link to="/forgot-password" className="btn-outline w-full">Send a new link</Link>
      </AuthShell>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await updatePassword(password);
    setBusy(false);
    if (!res.success) {
      setError(res.error ?? 'Could not update the password.');
      return;
    }
    toast('Password updated');
    navigate('/community', { replace: true });
  };

  return (
    <AuthShell title="Choose a new password" lead="At least 8 characters, with letters and numbers.">
      <form onSubmit={submit} noValidate>
        <Field label="New password">
          <input className="field" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <FormError message={error} />
        <button type="submit" className="btn-solid w-full" disabled={busy || !isPasswordValid(password)}>
          {busy ? 'Saving…' : 'Save new password'}
        </button>
      </form>
    </AuthShell>
  );
}
