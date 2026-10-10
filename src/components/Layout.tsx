import { useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useLog, type LogKind } from '../features/logging/QuickLog';

const TABS = [
  { to: '/', label: 'Home', icon: HomeIcon },
  { to: '/training', label: 'Training', icon: DumbbellIcon },
  { to: '/nutrition', label: 'Nutrition', icon: AppleIcon },
  { to: '/community', label: 'Community', icon: UsersIcon },
  { to: '/profile', label: 'Profile', icon: UserIcon },
];

const QUICK: { kind: LogKind; label: string; emoji: string }[] = [
  { kind: 'run', label: 'Run', emoji: '🏃' },
  { kind: 'strength', label: 'Gym sets', emoji: '🏋️' },
  { kind: 'hyrox', label: 'HYROX', emoji: '🔥' },
  { kind: 'meal', label: 'Meal', emoji: '🍽️' },
  { kind: 'water', label: 'Water', emoji: '💧' },
  { kind: 'weight', label: 'Weight', emoji: '⚖️' },
  { kind: 'sleep', label: 'Sleep', emoji: '😴' },
  { kind: 'steps', label: 'Steps', emoji: '👟' },
  { kind: 'recovery', label: 'Recovery', emoji: '🧘' },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full flex flex-col max-w-md mx-auto relative">
      <main className="flex-1 px-4 pb-28 pt-2">{children}</main>
      <QuickActionFab />
      <BottomNav />
    </div>
  );
}

export function AppHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="pt-safe sticky top-0 z-30 -mx-4 px-4 pb-3 bg-bg/90 backdrop-blur border-b border-line/60 mb-3">
      <div className="flex items-center justify-between pt-2">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">{title}</h1>
          {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {right}
          <button
            onClick={() => nav('/coach')}
            className="h-9 pl-2.5 pr-3 rounded-full bg-accent/15 border border-accent/30 text-accent font-semibold text-sm flex items-center gap-1.5"
            aria-label="Open coach"
          >
            ✦ Coach
          </button>
        </div>
      </div>
    </header>
  );
}

function BottomNav() {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-line bg-surface/95 backdrop-blur pb-safe">
      <div className="max-w-md mx-auto grid grid-cols-5">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-semibold transition ${isActive ? 'text-accent' : 'text-muted'}`
            }
          >
            {({ isActive }) => (
              <>
                <t.icon active={isActive} />
                {t.label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function QuickActionFab() {
  const [open, setOpen] = useState(false);
  const log = useLog();
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/50 animate-fade" onClick={() => setOpen(false)} />}
      <div className="fixed bottom-20 right-4 z-50 flex flex-col items-end gap-2">
        {open && (
          <div className="grid grid-cols-3 gap-2 mb-1 animate-rise">
            {QUICK.map((q) => (
              <button
                key={q.kind}
                onClick={() => {
                  setOpen(false);
                  log(q.kind);
                }}
                className="w-20 h-20 rounded-2xl bg-surface border border-line flex flex-col items-center justify-center gap-1 shadow-card active:scale-95 transition"
              >
                <span className="text-2xl">{q.emoji}</span>
                <span className="text-[10px] font-semibold text-muted">{q.label}</span>
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setOpen((o) => !o)}
          className={`w-14 h-14 rounded-full bg-accent text-black shadow-card flex items-center justify-center text-3xl font-light transition ${open ? 'rotate-45' : ''}`}
          aria-label="Quick log"
        >
          +
        </button>
      </div>
    </>
  );
}

// ── Icons (inline, theme-aware) ──────────────────────────────────────────────
type IconP = { active?: boolean };
const ic = (active?: boolean) => (active ? '#ff5a1f' : '#8b93a3');
function HomeIcon({ active }: IconP) {
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={ic(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>);
}
function DumbbellIcon({ active }: IconP) {
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={ic(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 6.5 17.5 17.5" /><path d="m3 7 1 1M20 16l1 1M7 3l1 1M16 20l1 1" /><rect x="2" y="9" width="4" height="6" rx="1" transform="rotate(-45 4 12)" /><rect x="18" y="9" width="4" height="6" rx="1" transform="rotate(-45 20 12)" /></svg>);
}
function AppleIcon({ active }: IconP) {
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={ic(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 7c0-2 1.5-3.5 3.5-3.5" /><path d="M12 7c-2.5-2-6-1-7 1.5-1.2 3 .5 8 3 10 1 .8 2 .3 3-.2s2 .7 3 .2c2.5-2 4.2-7 3-10-1-2.5-4.5-3.5-7-1.5" /></svg>);
}
function UsersIcon({ active }: IconP) {
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={ic(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 2.5-5 6-5s6 2 6 5" /><path d="M16 5.5a3 3 0 0 1 0 5.5M18 20c0-2.2-.8-3.8-2-4.8" /></svg>);
}
function UserIcon({ active }: IconP) {
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={ic(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" /></svg>);
}
