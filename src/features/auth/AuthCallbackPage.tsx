import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getSupabase } from '../../lib/supabase';
import { ensureProfile, mapAuthError, notifyAuthLinked, NOT_CONFIGURED } from '../../lib/authService';
import { AuthShell, FormError } from './AuthShell';

/** Landing page for the Google redirect and email-confirmation links. */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in dev
    started.current = true;
    (async () => {
      const client = getSupabase();
      if (!client) {
        setError(NOT_CONFIGURED);
        return;
      }
      // The provider can send an error back in the URL (e.g. the user cancelled).
      const params = new URLSearchParams(window.location.search + '&' + window.location.hash.replace(/^#/, ''));
      const providerError = params.get('error_description') ?? params.get('error');
      if (providerError) {
        setError(mapAuthError(providerError));
        return;
      }
      try {
        // getSession waits for the client to exchange the code in the URL.
        const { data, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        const user = data.session?.user;
        if (!user) {
          setError('Sign in did not complete. The link may have expired, or it was opened in a different browser.');
          return;
        }
        await ensureProfile(client, user);
        notifyAuthLinked(user.id);
        navigate('/community', { replace: true });
      } catch (err) {
        setError(mapAuthError(err));
      }
    })();
  }, [navigate]);

  if (error) {
    return (
      <AuthShell title="Sign in did not complete">
        <FormError message={error} />
        <Link to="/login" className="btn-outline w-full">Go to sign in</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Completing sign in…">
      <div className="h-1 w-full overflow-hidden rounded-full bg-secondary" role="status" aria-label="Completing sign in">
        <div className="h-full w-1/3 rounded-full bg-foreground/40 motion-safe:animate-pulse" />
      </div>
    </AuthShell>
  );
}
