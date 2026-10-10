import type { ReactNode } from 'react';
import { useEffect } from 'react';

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div className={`card p-4 ${onClick ? 'cursor-pointer active:scale-[0.99] transition' : ''} ${className}`} onClick={onClick}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2.5 mt-1">
      <h2 className="text-sm font-bold uppercase tracking-wider text-muted">{children}</h2>
      {action}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone = 'default',
  icon,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'accent' | 'info';
  icon?: ReactNode;
  onClick?: () => void;
}) {
  const toneClass =
    tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : tone === 'accent' ? 'text-accent' : tone === 'info' ? 'text-info' : 'text-text';
  return (
    <div className={`card p-3.5 ${onClick ? 'cursor-pointer active:scale-[0.99] transition' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      <div className={`mt-1 text-2xl font-extrabold tabular-nums ${toneClass}`}>{value}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

export function EmptyState({ title, hint, icon = '📭', action }: { title: string; hint?: string; icon?: string; action?: ReactNode }) {
  return (
    <div className="card p-6 text-center">
      <div className="text-3xl mb-2">{icon}</div>
      <div className="font-semibold text-text">{title}</div>
      {hint && <div className="text-sm text-muted mt-1">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function NotEnoughData({ what = 'this chart' }: { what?: string }) {
  return (
    <div className="card p-5 text-center text-muted text-sm">
      <div className="text-2xl mb-1">📊</div>
      Not enough data yet for {what}. Keep logging and it'll fill in.
    </div>
  );
}

export function StatusPill({ status }: { status: 'on_track' | 'needs_attention' | 'recovery' | 'missing' }) {
  const map = {
    on_track: { t: 'On track', c: 'bg-good/15 text-good' },
    needs_attention: { t: 'Needs attention', c: 'bg-warn/15 text-warn' },
    recovery: { t: 'Recovery recommended', c: 'bg-info/15 text-info' },
    missing: { t: 'Missing data', c: 'bg-muted/15 text-muted' },
  };
  const m = map[status];
  return <span className={`pill ${m.c}`}>{m.t}</span>;
}

export function Ring({ pct, size = 64, stroke = 7, children, color = '#ff5a1f' }: { pct: number; size?: number; stroke?: number; children?: ReactNode; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const off = c - (clamped / 100) * c;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#2a2f3a" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-sm font-bold">{children}</div>
    </div>
  );
}

export function Bar({ pct, color = '#ff5a1f', track = '#2a2f3a', height = 8 }: { pct: number; color?: string; track?: string; height?: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ background: track, height }}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${clamped}%`, background: color }} />
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/60 animate-fade" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-surface border-t sm:border border-line rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto animate-sheet shadow-card pb-safe">
        <div className="sticky top-0 bg-surface/95 backdrop-blur z-10 flex items-center justify-between px-4 py-3 border-b border-line">
          <h3 className="font-bold">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-2 border border-line flex items-center justify-center text-muted text-lg leading-none" aria-label="Close">
            ×
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex p-1 bg-surface-2 border border-line rounded-xl w-full">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 text-sm font-semibold py-2 rounded-lg transition ${value === o.value ? 'bg-accent text-black' : 'text-muted'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint, optional }: { label: string; children: ReactNode; hint?: string; optional?: boolean }) {
  return (
    <label className="block mb-3.5">
      <span className="label flex items-center gap-1.5">
        {label}
        {optional && <span className="text-[10px] normal-case font-medium text-muted/70 bg-surface-2 px-1.5 py-0.5 rounded">optional</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-muted mt-1 block">{hint}</span>}
    </label>
  );
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`btn-chip ${active ? 'bg-accent text-black border-accent' : 'bg-surface-2 text-text border-line'}`}
    >
      {children}
    </button>
  );
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-28 z-[60] bg-text text-bg font-semibold text-sm px-4 py-2.5 rounded-full shadow-card animate-rise">
      {msg}
    </div>
  );
}

export function InfoNote({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  const c = tone === 'warn' ? 'bg-warn/10 border-warn/30 text-warn' : 'bg-info/10 border-info/30 text-info';
  return <div className={`text-xs rounded-xl border px-3 py-2 ${c}`}>{children}</div>;
}
