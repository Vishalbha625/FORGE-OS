import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Home, Dumbbell, Utensils, Users, User, Plus, Sparkles, type LucideIcon } from 'lucide-react';
import { useLog, type LogKind } from '../features/logging/QuickLog';
import { ReminderRunner } from './ReminderRunner';
import { ThemeSwitcher } from '../store/theme';
import { LOG_ICONS } from './icons';

const TABS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/training', label: 'Training', icon: Dumbbell },
  { to: '/nutrition', label: 'Nutrition', icon: Utensils },
  { to: '/community', label: 'Community', icon: Users },
  { to: '/profile', label: 'Profile', icon: User },
];

const QUICK: { kind: LogKind; label: string }[] = [
  { kind: 'run', label: 'Run' },
  { kind: 'strength', label: 'Gym sets' },
  { kind: 'hyrox', label: 'HYROX' },
  { kind: 'meal', label: 'Meal' },
  { kind: 'water', label: 'Water' },
  { kind: 'weight', label: 'Weight' },
  { kind: 'sleep', label: 'Sleep' },
  { kind: 'steps', label: 'Steps' },
  { kind: 'recovery', label: 'Recovery' },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate min-h-full overflow-x-clip">
      <Navbar />
      <div className="relative mx-auto flex min-h-full max-w-md flex-col">
        <main className="flex-1 px-4 pb-32 pt-1">{children}</main>
        <ReminderRunner />
        <QuickActionFab />
      </div>
      <BottomNav />
    </div>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      {/* The logo is one of the few places orange is allowed. */}
      <svg viewBox="0 0 24 24" className="h-6 w-6 text-brand" aria-hidden>
        <path d="M7 4h11a1.5 1.5 0 0 1 0 3h-8.5v4.5H16a1.5 1.5 0 0 1 0 3H9.5V19a1.5 1.5 0 0 1-3 0V5.5A1.5 1.5 0 0 1 7 4z" fill="currentColor" />
        <circle cx="18" cy="17.5" r="2" fill="currentColor" />
      </svg>
      <span className="font-brand text-xl font-medium tracking-tight">Forge OS</span>
    </span>
  );
}

/** Sticky and transparent; blurs only after the page scrolls. */
function Navbar() {
  const nav = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 0);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={`pt-safe sticky top-0 z-40 transition-[backdrop-filter,background-color] duration-300 ${scrolled ? 'bg-background/60 backdrop-blur-md' : 'bg-transparent'}`}>
      <nav className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-3">
        <Link to="/" aria-label="Forge OS home">
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          <ThemeSwitcher />
          <button onClick={() => nav('/coach')} className="btn-outline h-9 px-3" aria-label="Open coach">
            <Sparkles className="h-4 w-4" aria-hidden /> Coach
          </button>
        </div>
      </nav>
    </header>
  );
}

/** Centred page title with an optional lead and actions. */
export function AppHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 mt-3 space-y-2">
      <h1 className="page-title">{title}</h1>
      {subtitle && <p className="mx-auto max-w-sm text-center text-sm text-muted">{subtitle}</p>}
      {right && <div className="flex justify-center gap-2 pt-1">{right}</div>}
    </div>
  );
}

function BottomNav() {
  return (
    <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto grid max-w-md grid-cols-5">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) =>
              `relative flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${isActive ? 'text-foreground' : 'text-muted hover:text-foreground'}`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute top-0 h-px w-8 bg-highlight" aria-hidden />}
                <t.icon className="h-5 w-5" strokeWidth={isActive ? 2 : 1.6} aria-hidden />
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
  const { pathname } = useLocation();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  // The coach screen has its own input bar where this button would sit.
  if (pathname === '/coach') return null;
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm animate-fade" onClick={() => setOpen(false)} />}
      <div className="fixed bottom-20 right-4 z-50 flex flex-col items-end gap-2" style={{ right: 'max(1rem, calc((100vw - 28rem) / 2 + 1rem))' }}>
        {open && (
          <div className="mb-1 grid grid-cols-3 gap-2 animate-rise" role="menu" aria-label="Quick log">
            {QUICK.map((q) => {
              const Icon = LOG_ICONS[q.kind];
              return (
                <button
                  key={q.kind}
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    log(q.kind);
                  }}
                  className="flex h-20 w-20 flex-col items-center justify-center gap-1.5 rounded-xl border bg-card text-foreground transition-colors hover:border-[color:var(--card-edge-hover)]"
                  style={{ borderColor: 'var(--card-edge)' }}
                >
                  <Icon className="h-5 w-5" strokeWidth={1.7} aria-hidden />
                  <span className="text-[11px] font-medium text-muted">{q.label}</span>
                </button>
              );
            })}
          </div>
        )}
        <button
          onClick={() => setOpen((o) => !o)}
          className="btn-solid h-14 w-14 p-0"
          aria-label="Quick log"
          aria-expanded={open}
        >
          <Plus className={`h-6 w-6 transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-45' : ''}`} aria-hidden />
        </button>
      </div>
    </>
  );
}
