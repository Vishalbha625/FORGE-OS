import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../store/AuthContext';

/** Community routes only. Health routes are never wrapped in this. */
export function AuthGuard({ children, fallbackPath = '/login' }: { children: ReactNode; fallbackPath?: string }) {
  const { loading, isSupabaseAvailable, isAuthenticated } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="py-16 text-center text-sm text-muted motion-safe:animate-pulse" role="status">Loading…</div>;
  }
  if (!isSupabaseAvailable) {
    return (
      <div className="py-16 text-center" role="status">
        <p className="font-medium">Community features are not available yet.</p>
        <p className="mt-1 text-xs text-muted">Supabase is not configured.</p>
      </div>
    );
  }
  if (!isAuthenticated) {
    return <Navigate to={fallbackPath} replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}
