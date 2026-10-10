import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './store/AppContext';
import { ToastProvider } from './store/toast';
import { LogProvider } from './features/logging/QuickLog';
import { Layout } from './components/Layout';
import { Onboarding } from './features/onboarding/Onboarding';
import { Dashboard } from './features/dashboard/Dashboard';
import { Training } from './features/training/Training';
import { Nutrition } from './features/nutrition/Nutrition';
import { Community } from './features/community/Community';
import { Profile } from './features/profile/Profile';
import { Coach } from './features/coach/Coach';
import { Analytics } from './features/analytics/Analytics';
import { Sleep } from './features/health/Sleep';
import { Steps } from './features/health/Steps';
import { Body } from './features/health/Body';
import { Recovery } from './features/health/Recovery';
import { Hydration } from './features/health/Hydration';

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
