import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppState } from '../../store/AppContext';

vi.mock('../../lib/supabase', () => ({ getSupabase: vi.fn(() => null), isSupabaseConfigured: () => false }));
vi.mock('../../store/AppContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/AppContext')>()),
  useApp: () => (globalThis as { __forgeApp?: AppState }).__forgeApp,
}));

import { getSupabase } from '../../lib/supabase';
import { signUpWithEmail } from '../../lib/authService';
import { estimateNutrition } from '../../lib/calc';
import { Dashboard } from '../../features/dashboard/Dashboard';
import { AnalyticsPage } from '../../features/analytics/AnalyticsPage';
import { Profile as ProfilePage } from '../../features/profile/Profile';
import { FakeBackend } from './fakeBackend';
import { loadState, renderPage, textOf } from './appHarness';
import { freshDevice, laterPlan, logMeal, logRun, logStrength, onboard, settle, today } from './journeyFixtures';
import { addDays, startOfWeek } from '../../lib/dates';

// A new member, from sign-up to their first logs showing up on the dashboard
// and in Progress. Health data stays in IndexedDB; only sign-up talks to the
// (fake) community backend.

beforeEach(async () => {
  vi.mocked(getSupabase).mockReturnValue(null);
  await freshDevice();
});

describe('new user journey', () => {
  it('signs up, gets a community profile, finishes onboarding and sees a rest day', async () => {
    const backend = new FakeBackend();
    vi.mocked(getSupabase).mockReturnValue(backend.client());
    vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { origin: 'https://forge.test' } }));

    const res = await signUpWithEmail('Vishal@Example.com', 'hyrox2027', '  Vishal Bhardwaj ');
    await settle(); // the profile row is written in the background
    expect(res.success).toBe(true);
    expect(backend.tables.profiles).toEqual([expect.objectContaining({ id: res.user?.id, display_name: 'Vishal Bhardwaj' })]);

    await onboard({ ...laterPlan(), supabaseUserId: res.user?.id });
    const state = await loadState();
    expect(state.profile).toMatchObject({ onboarded: true, displayName: 'Vishal Bhardwaj' });
    expect(state.data.plannedWorkouts.some((w) => w.eventDate === today())).toBe(false);

    const page = textOf(renderPage(Dashboard));
    expect(page).toContain('Hi, Vishal');
    expect(page).toContain('Rest day');
    expect(page).toContain('Nothing is planned today.');
    expect(page).toContain('Your plan starts on');
    vi.unstubAllGlobals();
  });

  it('logs a run: the dashboard week total and the running chart pick it up', async () => {
    await onboard({ trainingStartDate: startOfWeek(today()), raceDate: addDays(today(), 100) });
    await loadState();
    expect(textOf(renderPage(Dashboard))).toMatch(/Distance 0 km/);
    expect(textOf(renderPage(AnalyticsPage))).toContain('No running data this week.');

    await logRun({ distanceKm: 8, durationSec: 2640 });
    await loadState();
    expect(textOf(renderPage(Dashboard))).toMatch(/Distance 8 km/);
    const progress = textOf(renderPage(AnalyticsPage));
    expect(progress).not.toContain('No running data');
    expect(progress).toMatch(/Running Show table 8 km of [\d.]+ km planned · 1 run · average pace 5:30\/km/);
  });

  it('logs strength: the strength chart counts completed sets per muscle group', async () => {
    await onboard(laterPlan());
    await logStrength();
    await loadState();
    const progress = textOf(renderPage(AnalyticsPage));
    expect(progress).not.toContain('No strength data');
    expect(progress).toContain('6 sets · 1 session · volume 1,800 kg');
    expect(progress).toMatch(/Strength Show table .* Legs Core/);
  });

  it('logs meals: the nutrition chart shows daily calories against the estimated target', async () => {
    const profile = await onboard(laterPlan());
    await logMeal({ meal: 'breakfast', calories: 650, protein: 35, carbs: 80, fat: 18 });
    await logMeal({ meal: 'dinner', calories: 1150, protein: 60, carbs: 140, fat: 35 });
    await loadState();
    const target = estimateNutrition(profile).calories!;
    const progress = textOf(renderPage(AnalyticsPage));
    expect(progress).toContain(`1,800 kcal a day · target ${target.toLocaleString('en-GB')} kcal`);
    expect(progress).toMatch(/protein \d+%, carbs \d+%, fat \d+%/);
  });

  it('completes all 8 onboarding steps: the profile keeps the answers and settings open', async () => {
    await onboard({ displayName: 'Riya Sharma', goals: ['hyrox', 'strength'], primaryGoal: 'strength', ...laterPlan() });
    const state = await loadState();
    expect(state.profile).toMatchObject({ displayName: 'Riya Sharma', goals: ['hyrox', 'strength'], primaryGoal: 'strength', onboarded: true, best5kSec: 1470 });
    expect(state.settings?.reminders.length).toBeGreaterThan(0);
    expect(state.data.plannedWorkouts.length).toBeGreaterThan(90);

    const settings = textOf(renderPage(ProfilePage, '/profile'));
    for (const section of ['Reminders', 'Meal logging (3 a day)', 'Appearance', 'About', 'Version 1.1.0', 'Export my data']) expect(settings).toContain(section);
  });
});
