import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { X, Info, TriangleAlert, BarChart3, Inbox, type LucideIcon } from 'lucide-react';

// ChaiUI building blocks for Forge OS. Rules: warm hairline cards without
// shadow, sentence case, status as text + thin outline, progress is neutral,
// and orange never fills anything.

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div
      className={`card p-4 ${onClick ? 'card-link' : ''} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick()) : undefined}
    >
      {children}
    </div>
  );
}

/** The cream highlight phrase. One per paragraph. */
export function Highlight({ children }: { children: ReactNode }) {
  return <span className="highlight">{children}</span>;
}

export function SectionTitle({ children, action, lead }: { children: ReactNode; action?: ReactNode; lead?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 first:mt-2">
      <div className="flex items-end justify-between gap-3">
        <h2 className="section-title">{children}</h2>
        {action}
      </div>
      {lead && <p className="mt-1 text-sm text-muted">{lead}</p>}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone = 'default',
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'accent' | 'info';
  onClick?: () => void;
}) {
  const toneClass =
    tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : tone === 'accent' ? 'text-highlight' : tone === 'info' ? 'text-info' : 'text-foreground';
  return (
    <Card onClick={onClick} className="p-3.5">
      {/* Data label: the one place caps are allowed. */}
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 font-montserrat text-2xl font-semibold tabular-nums tracking-tight ${toneClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </Card>
  );
}

export function EmptyState({ title, hint, icon: Icon = Inbox, action }: { title: string; hint?: string; icon?: LucideIcon; action?: ReactNode }) {
  return (
    <Card className="p-6 text-center">
      <Icon className="mx-auto mb-2 h-6 w-6 text-muted" strokeWidth={1.5} aria-hidden />
      <div className="font-medium">{title}</div>
      {hint && <div className="mt-1 text-sm text-muted">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </Card>
  );
}

export function NotEnoughData({ what = 'this chart' }: { what?: string }) {
  return (
    <div className="py-8 text-center text-sm text-muted">
      <BarChart3 className="mx-auto mb-2 h-5 w-5" strokeWidth={1.5} aria-hidden />
      Not enough data yet for {what}. Keep logging and it will fill in.
    </div>
  );
}

const STATUS: Record<'on_track' | 'needs_attention' | 'recovery' | 'missing', [string, string]> = {
  on_track: ['On track', 'border-good/40 text-good'],
  needs_attention: ['Needs attention', 'border-warn/40 text-warn'],
  recovery: ['Recovery recommended', 'border-info/40 text-info'],
  missing: ['Missing data', 'border-border text-muted'],
};
export function StatusPill({ status }: { status: keyof typeof STATUS }) {
  const [label, cls] = STATUS[status];
  return <span className={`pill ${cls}`}>{label}</span>;
}

/** Circular progress. Neutral by design: progress is never orange. */
export function Ring({ pct, size = 64, stroke = 6, children }: { pct: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const off = c - (clamped / 100) * c;
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" className="stroke-border" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
          className="stroke-foreground/85 transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-montserrat text-sm font-semibold tabular-nums">{children}</div>
    </div>
  );
}

/** Linear progress. Neutral. */
export function Bar({ pct, height = 6, label }: { pct: number; height?: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="w-full overflow-hidden rounded-full bg-border" style={{ height }} role="progressbar" aria-valuenow={Math.round(clamped)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full rounded-full bg-foreground/80 transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function IconButton({ label, onClick, children, className = '' }: { label: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border text-foreground/80 transition-colors hover:text-foreground disabled:opacity-30 ${className}`}
    >
      {children}
    </button>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm animate-fade" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border bg-card pb-safe animate-sheet sm:max-w-md sm:rounded-2xl"
        style={{ borderColor: 'var(--card-edge)' }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/90 px-4 py-3 backdrop-blur">
          <h3 className="font-medium tracking-tight">{title}</h3>
          <IconButton label="Close" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden />
          </IconButton>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-full overflow-hidden rounded-md border border-border bg-white dark:bg-black/50">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${i > 0 ? 'border-l border-border' : ''} ${value === o.value ? 'seg-on' : 'seg-off'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint, optional }: { label: string; children: ReactNode; hint?: string; optional?: boolean }) {
  return (
    <label className="mb-4 block">
      <span className="label">
        {label}
        {optional && <span className="ml-1.5 font-normal text-muted">(optional)</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`btn-chip ${active ? 'chip-on' : 'chip-off'}`}>
      {children}
    </button>
  );
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div role="status" aria-live="polite" className="fixed bottom-28 left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground animate-rise">
      {msg}
    </div>
  );
}

export function InfoNote({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  const warn = tone === 'warn';
  const Icon = warn ? TriangleAlert : Info;
  return (
    <div className={`flex gap-2.5 rounded-lg border px-3 py-2.5 text-xs leading-relaxed ${warn ? 'border-warn/40 text-warn' : 'border-border text-muted'}`}>
      <Icon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** ChaiUI animated badge: a 1px orange glint travels round the border. */
export function AnimatedBadge({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-flex w-fit overflow-hidden rounded-full p-px">
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 h-5 w-[300px] rounded-full bg-gradient-to-r from-transparent via-transparent to-orange-500 motion-safe:animate-[chai-spin_4s_linear_infinite]"
        style={{ transform: 'translate(-50%,-50%)' }}
      />
      <span className="relative z-10 rounded-full bg-neutral-50 px-4 py-2 text-sm font-medium text-neutral-800 dark:bg-stone-900 dark:text-neutral-100">
        {children}
      </span>
    </span>
  );
}

/** On/off switch. Neutral: on is the foreground colour, never orange. */
export function Toggle({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${on ? 'border-transparent bg-foreground' : 'border-border bg-secondary'}`}>
      <span className={`absolute top-[3px] h-4 w-4 rounded-full transition-all motion-reduce:transition-none ${on ? 'left-[22px] bg-background' : 'left-[3px] bg-foreground/70'}`} />
    </button>
  );
}
