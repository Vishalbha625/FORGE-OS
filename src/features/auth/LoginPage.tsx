import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Field } from '../../components/ui';
import { useAuth } from '../../store/AuthContext';
import { notifyAuthLinked, signInWithEmail, signInWithGoogle } from '../../lib/authService';
import { AuthShell, FormError, returnPath } from './AuthShell';

export function LoginPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const to = returnPath(location);

  if (!authLoading && isAuthenticated && !busy) return <Navigate to={to} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await signInWithEmail(email, password);
    if (res.success && res.user) {
      notifyAuthLinked(res.user.id);
      navigate(to, { replace: true });
      return;
    }
    setBusy(false);
    setError(res.error ?? 'Could not sign in.');
  };

  const google = async () => {
    setError(null);
    const res = await signInWithGoogle();
    if (!res.success) setError(res.error ?? 'Could not start Google sign-in.');
  };

  return (
    <AuthShell title="Sign in" lead={<>Your community account. <span className="highlight">Health data stays on this device</span>.</>}>
      <form onSubmit={submit} noValidate>
        <Field label="Email">
          <input className="field" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input className="field" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <FormError message={error} />
        <button type="submit" className="btn-solid w-full" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <button type="button" className="btn-outline mt-3 w-full" onClick={google} disabled={busy}>Sign in with Google</button>
      <div className="mt-6 flex flex-col items-center gap-3 text-center">
        <Link to="/forgot-password" className="link">Forgot password?</Link>
        <p className="text-sm text-muted">
          Don't have an account? <Link to="/signup" state={location.state} className="link">Sign up</Link>
        </p>
      </div>
    </AuthShell>
  );
}
