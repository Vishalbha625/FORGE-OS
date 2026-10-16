import type { ReactNode } from 'react';
import { Link, type Location } from 'react-router-dom';
import { Logo } from '../../components/Layout';
import { ThemeSwitcher } from '../../store/theme';

/** Full-screen centred frame for the sign-in pages (no tab bar). */
export function AuthShell({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col px-4 pb-8">
      <header className="pt-safe flex items-center justify-between py-3">
        <Link to="/" aria-label="Back to Forge OS">
          <Logo />
        </Link>
        <ThemeSwitcher />
      </header>
      <main className="flex flex-1 flex-col justify-center py-6 animate-rise">
        <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
        {lead && <p className="mb-6 mt-1.5 text-sm text-muted">{lead}</p>}
        {!lead && <div className="mb-6" />}
        {children}
      </main>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="mb-4 rounded-lg border border-bad/40 px-3 py-2.5 text-sm text-bad">{message}</p>;
}

/**
 * Where to go after signing in: the page that sent us here, else home. Only a
 * path on this site: no "//host", and no backslashes or control characters,
 * which browsers can turn into "//host" (an open redirect).
 */
export function returnPath(location: Pick<Location, 'state'>): string {
  const from = (location.state as { from?: unknown } | null)?.from;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !/[\\\u0000-\u001f]/.test(from) ? from : '/';
}
