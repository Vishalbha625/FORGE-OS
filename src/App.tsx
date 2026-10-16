import { lazy, Suspense, useEffect, type ReactNode } from 'react';
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
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageTransition } from './components/PageTransition';
import { SkeletonCard, SkeletonChart, SkeletonLine, SkeletonPost } from './components/Skeleton';

// Every page is split into its own chunk, loaded on first visit.
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const Onboarding = page(() => import('./features/onboarding/Onboarding'), 'Onboarding');
const Dashboard = page(() => import('./features/dashboard/Dashboard'), 'Dashboard');
const Training = page(() => import('./features/training/Training'), 'Training');
const Nutrition = page(() => import('./features/nutrition/Nutrition'), 'Nutrition');
const FeedPage = page(() => import('./features/community/FeedPage'), 'FeedPage');
const PostDetailPage = page(() => import('./features/community/PostDetailPage'), 'PostDetailPage');
const SearchUsersPage = page(() => import('./features/community/SearchUsersPage'), 'SearchUsersPage');
const ProfilePage = page(() => import('./features/community/ProfilePage'), 'ProfilePage');
const FollowersListPage = page(() => import('./features/community/FollowersListPage'), 'FollowersListPage');
const BlockedUsersPage = page(() => import('./features/community/BlockedUsersPage'), 'BlockedUsersPage');
const Profile = page(() => import('./features/profile/Profile'), 'Profile');
const Coach = page(() => import('./features/coach/CoachPage'), 'CoachPage');
const AnalyticsPage = page(() => import('./features/analytics/AnalyticsPage'), 'AnalyticsPage');
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
const NotFoundPage = page(() => import('./features/notfound/NotFoundPage'), 'NotFoundPage');
const NotificationsPage = page(() => import('./features/notifications/NotificationsPage'), 'NotificationsPage');

type Shape = 'page' | 'charts' | 'feed';

/** A placeholder in the shape of the page that's loading. */
function PageLoading({ shape = 'page' }: { shape?: Shape }) {
  return (
    <div className="space-y-3 pt-6" role="status" aria-label="Loading">
      <SkeletonLine width="w-1/3" className="mx-auto mb-6" />
      {shape === 'charts' ? (
        <>
          <SkeletonCard />
          <SkeletonChart />
          <SkeletonChart />
        </>
      ) : shape === 'feed' ? (
        <>
          <SkeletonPost />
          <SkeletonPost />
        </>
      ) : (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      )}
    </div>
  );
}

/** One crash boundary and one loading state per app section. */
function Section({ name, shape, children }: { name: string; shape?: Shape; children: ReactNode }) {
  return (
    <ErrorBoundary section={name}>
      <Suspense fallback={<PageLoading shape={shape} />}>{children}</Suspense>
    </ErrorBoundary>
  );
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
    return (
      <Section name="onboarding">
        <Onboarding />
      </Section>
    );
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
  const community = (el: ReactNode) => (
    <Section name="community" shape="feed">
      <AuthGuard>{el}</AuthGuard>
    </Section>
  );
  const health = (el: ReactNode) => <Section name="health">{el}</Section>;
  return (
    <LogProvider>
      <Layout>
        <PageTransition>
          <Routes>
            <Route path="/" element={<Section name="dashboard"><Dashboard /></Section>} />
            <Route path="/training" element={<Section name="training"><Training /></Section>} />
            <Route path="/nutrition" element={<Section name="nutrition"><Nutrition /></Section>} />
            <Route path="/community" element={community(<FeedPage />)} />
            <Route path="/community/post/:postId" element={community(<PostDetailPage />)} />
            <Route path="/community/search" element={community(<SearchUsersPage />)} />
            <Route path="/community/blocked" element={community(<BlockedUsersPage />)} />
            <Route path="/community/profile/:userId" element={community(<ProfilePage />)} />
            <Route path="/community/profile/:userId/followers" element={community(<FollowersListPage />)} />
            <Route path="/community/profile/:userId/following" element={community(<FollowersListPage />)} />
            <Route path="/community/*" element={<Navigate to="/community" replace />} />
            <Route path="/notifications" element={community(<NotificationsPage />)} />
            <Route path="/profile" element={<Section name="settings"><Profile /></Section>} />
            <Route path="/coach" element={<Section name="coach"><Coach /></Section>} />
            <Route path="/analytics" element={<Section name="analytics" shape="charts"><AnalyticsPage /></Section>} />
            <Route path="/sleep" element={health(<Sleep />)} />
            <Route path="/steps" element={health(<Steps />)} />
            <Route path="/body" element={health(<Body />)} />
            <Route path="/recovery" element={health(<Recovery />)} />
            <Route path="/hydration" element={health(<Hydration />)} />
            <Route path="*" element={<Section name="not found"><NotFoundPage /></Section>} />
          </Routes>
        </PageTransition>
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
