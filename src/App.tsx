import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './store/AppContext';
import { ToastProvider } from './store/toast';
import { LogProvider } from './features/logging/QuickLog';
import { Layout } from './components/Layout';
import { Onboarding } from './features/onboarding/Onboarding';
import { Dashboard } from './features/dashboard/Dashboard';

// Home and onboarding load eagerly; the rest are split into their own chunks.
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const Training = page(() => import('./features/training/Training'), 'Training');
const Nutrition = page(() => import('./features/nutrition/Nutrition'), 'Nutrition');
const Community = page(() => import('./features/community/Community'), 'Community');
const Profile = page(() => import('./features/profile/Profile'), 'Profile');
const Coach = page(() => import('./features/coach/Coach'), 'Coach');
const Analytics = page(() => import('./features/analytics/Analytics'), 'Analytics');
const Sleep = page(() => import('./features/health/Sleep'), 'Sleep');
const Steps = page(() => import('./features/health/Steps'), 'Steps');
const Body = page(() => import('./features/health/Body'), 'Body');
const Recovery = page(() => import('./features/health/Recovery'), 'Recovery');
const Hydration = page(() => import('./features/health/Hydration'), 'Hydration');

function PageLoading() {
  return <div className="py-16 text-center text-muted text-sm animate-pulse">Loading…</div>;
}

function Gate() {
  const { loading, profile } = useApp();

  if (loading) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center gap-3 text-muted">
        <div className="text-4xl animate-pulse">🔥</div>
        <div className="font-semibold">Forge OS</div>
      </div>
    );
  }

  if (!profile || !profile.onboarded) {
    return <Onboarding />;
  }

  return (
    <LogProvider>
      <Layout>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/training" element={<Training />} />
            <Route path="/nutrition" element={<Nutrition />} />
            <Route path="/community" element={<Community />} />
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

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <Gate />
      </ToastProvider>
    </AppProvider>
  );
}
