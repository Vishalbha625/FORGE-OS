import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TriangleAlert, CircleHelp } from 'lucide-react';

// ChaiUI confirm dialog: portal to <body>, frosted backdrop, role="alertdialog",
// focus starts on the safe choice, Escape and the backdrop cancel. The body
// says exactly what will happen.

export interface ConfirmOptions {
  title: string;
  /** What will happen, in plain words. */
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = destructive (red confirm button); default = a normal question. */
  tone?: 'danger' | 'default';
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...o, resolve })), []);
  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {pending && createPortal(<ConfirmDialog {...pending} onClose={close} />, document.body)}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmCtx);
}

/** Standard delete confirmation for a logged record. */
export function useConfirmDelete() {
  const ask = useContext(ConfirmCtx);
  return (what: string, detail?: string) =>
    ask({
      title: `Delete ${what}?`,
      description: detail ?? 'It will be removed from your history and totals. A copy of what it held stays in Profile, Edit history.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
}

/** "This looks like a duplicate" question before saving. */
export function useConfirmDuplicate() {
  const ask = useContext(ConfirmCtx);
  return (description: string) =>
    ask({ title: 'This looks like a duplicate', description, confirmLabel: 'Save anyway', cancelLabel: "Don't save" });
}

function ConfirmDialog({ title, description, confirmLabel = 'Confirm', cancelLabel = 'Keep it', tone = 'default', onClose }: ConfirmOptions & { onClose: (ok: boolean) => void }) {
  const safeRef = useRef<HTMLButtonElement>(null);
  const danger = tone === 'danger';

  useEffect(() => {
    safeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const Icon = danger ? TriangleAlert : CircleHelp;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm animate-fade" onClick={() => onClose(false)} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={description ? 'confirm-desc' : undefined}
        className="relative w-full max-w-sm rounded-2xl border bg-card p-6 animate-rise"
        style={{ borderColor: 'var(--card-edge-hover)' }}
      >
        <div className={`mb-4 grid h-10 w-10 place-items-center rounded-full ${danger ? 'bg-red-500/10 text-bad' : 'bg-secondary text-foreground/80'}`}>
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <h2 id="confirm-title" className="text-lg font-medium tracking-tight">{title}</h2>
        {description && <div id="confirm-desc" className="mt-1.5 text-sm text-muted">{description}</div>}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button ref={safeRef} className="btn-outline" onClick={() => onClose(false)}>{cancelLabel}</button>
          <button className={danger ? 'btn-danger' : 'btn-soft'} onClick={() => onClose(true)}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
