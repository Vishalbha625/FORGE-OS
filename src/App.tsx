import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './store/AppContext';
import { ToastProvider } from './store/toast';
import { LogProvider } from './features/logging/QuickLog';
import { Layout, Logo } from './components/Layout';
import { ThemeProvider } from './store/theme';
import { ConfirmProvider } from './store/confirm';
import { AuthProvider, useAuth } from './store/AuthContext';
import { getDB } from './db/database';
import { AuthGuard } from './features/auth/AuthGuard';
import { Onboarding } from './features/onboarding/Onboarding';
import { Dashboard } from './features/dashboard/Dashboard';

// Home and onboarding load eagerly; the rest are split into their own chunks.
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const Training = page(() => import('./features/training/Training'), 'Training');
const Nutrition = page(() => import('./features/nutrition/Nutrition'), 'Nutrition');
const FeedPage = page(() => import('./features/community/FeedPage'), 'FeedPage');
const PostDetailPage = page(() => import('./features/community/PostDetailPage'), 'PostDetailPage');
const SearchUsersPage = page(() => import('./features/community/SearchUsersPage'), 'SearchUsersPage');
const ProfilePage = page(() => import('./features/community/ProfilePage'), 'ProfilePage');
const FollowersListPage = page(() => import('./features/community/FollowersListPage'), 'FollowersListPage');
const Profile = page(() => import('./features/profile/Profile'), 'Profile');
const Coach = page(() => import('./features/coach/Coach'), 'Coach');
const Analytics = page(() => import('./features/analytics/Analytics'), 'Analytics');
const Sleep = page(() => import('./features/health/Sleep'), 'Sleep');
const Steps = page(() => import('./features/health/Steps'), 'Steps');
const Body = page(() => import('./features/health/Body'), 'Body');
const Recovery = page(() => import('./features/health/Recovery'), 'Recovery');
const Hydration = page(() => import('./features/health/Hydration'), 'Hydration');
const LoginPage = page(() => import('./features/auth/LoginPage'), 'LoginPage');
const SignUpPage = page(() => import('./features/auth/SignUpPage'), 'SignUpPage');
const ForgotPasswordPage = page(() => import('./features/auth/ForgotPasswordPage'), 'ForgotPasswordPage');
const AuthCallbackPage = page(() => import('./features/auth/AuthCallbackPage'), 'AuthCallbackPage');
const ResetPasswordPage = page(() => import('./features/auth/ResetPasswordPage'), 'ResetPasswordPage');

function PageLoading() {
  return <div className="py-16 text-center text-muted text-sm animate-pulse">Loading…</div>;
}

function Gate() {
  const { loading, profile } = useApp();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center motion-safe:animate-pulse">
        <Logo />
      </div>
    );
  }

  if (!profile || !profile.onboarded) {
    return <Onboarding />;
  }

  // Sign-in pages are full screen. Only community routes require an account:
  // every health feature works without signing in.
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/auth/reset" element={<ResetPasswordPage />} />
        <Route path="*" element={<MainApp />} />
      </Routes>
    </Suspense>
  );
}

function MainApp() {
  return (
    <LogProvider>
      <Layout>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/training" element={<Training />} />
            <Route path="/nutrition" element={<Nutrition />} />
            <Route path="/community" element={<AuthGuard><FeedPage /></AuthGuard>} />
            <Route path="/community/post/:postId" element={<AuthGuard><PostDetailPage /></AuthGuard>} />
            <Route path="/community/search" element={<AuthGuard><SearchUsersPage /></AuthGuard>} />
            <Route path="/community/profile/:userId" element={<AuthGuard><ProfilePage /></AuthGuard>} />
            <Route path="/community/profile/:userId/followers" element={<AuthGuard><FollowersListPage /></AuthGuard>} />
            <Route path="/community/profile/:userId/following" element={<AuthGuard><FollowersListPage /></AuthGuard>} />
            <Route path="/community/*" element={<Navigate to="/community" replace />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/coach" element={<Coach />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/sleep" element={<Sleep />} />
            <Route path="/steps" element={<Steps />} />
            <Route path="/body" element={<Body />} />
            <Route path="/recovery" element={<Recovery />} />
            <Route path="/hydration" element={<Hydration />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    </LogProvider>
  );
}

/**
 * Sends community writes queued while offline, now and whenever the
 * connection returns. Loaded lazily, and only once someone is signed in.
 */
function OfflineQueueRunner() {
  const { isAuthenticated } = useAuth();
  useEffect(() => {
    if (!isAuthenticated) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    Promise.all([getDB(), import('./lib/offlineQueueProcessor')])
      .then(([db, { setupOfflineQueueListener }]) => {
        if (!cancelled) cleanup = setupOfflineQueueListener(db);
      })
      .catch((err) => console.warn('Offline queue not started.', err));
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [isAuthenticated]);
  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <OfflineQueueRunner />
      <ThemeProvider>
        <AppProvider>
          <ToastProvider>
            <ConfirmProvider>
              <Gate />
            </ConfirmProvider>
          </ToastProvider>
        </AppProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
