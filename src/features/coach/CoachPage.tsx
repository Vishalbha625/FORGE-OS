import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ClipboardList, Send, WifiOff, X } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { AppHeader } from '../../components/Layout';
import { Chip, Highlight, Segmented } from '../../components/ui';
import { generateWeeklyReport } from '../../lib/coach';
import { askCoach, checkCoachHealth, getRemainingQuestions, hasCoachUrl, type CoachResponse, type CoachTurn } from '../../lib/coachService';
import { parseSimpleMarkdown, type Inline } from '../../lib/simpleMarkdown';

interface Msg extends Partial<CoachResponse> {
  id: number;
  role: 'user' | 'coach';
  text: string;
}

const QUICK_QUESTIONS = [
  'How was my week?',
  'Am I on track for HYROX?',
  'What should I eat today?',
  "How's my recovery?",
  "Suggest tomorrow's workout",
];

const SOURCE_LABEL = { 'rule-based': 'Rule-based', ai: 'AI', 'ai-fallback': 'AI (offline fallback)' } as const;
const TAG_STYLE: Record<string, string> = {
  fact: 'border-good/40 text-good',
  calculation: 'border-border text-foreground/80',
  estimate: 'border-warn/40 text-warn',
  suggestion: 'border-accent/40 text-accent',
  missing: 'border-border text-muted',
};
const NOTICE_KEY = 'forge-os:coach-ai-notice-dismissed';
const readFlag = (k: string) => {
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
};

function InlineText({ runs }: { runs: Inline[] }) {
  return <>{runs.map((r, i) => (r.bold ? <strong key={i} className="font-semibold">{r.text}</strong> : <span key={i}>{r.text}</span>))}</>;
}

/** **bold** and "- " bullets only, rendered as elements (never as HTML). */
function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {parseSimpleMarkdown(text).map((b, i) =>
        b.type === 'list' ? (
          <ul key={i} className="list-disc space-y-0.5 pl-5">{b.items.map((item, j) => <li key={j}><InlineText runs={item} /></li>)}</ul>
        ) : (
          <p key={i}>{b.lines.map((line, j) => <span key={j} className="block"><InlineText runs={line} /></span>)}</p>
        ),
      )}
    </div>
  );
}

function Notice({ children, onClose, tone = 'muted' }: { children: ReactNode; onClose?: () => void; tone?: 'muted' | 'warn' }) {
  return (
    <div role="status" className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${tone === 'warn' ? 'border-warn/40 text-warn' : 'border-border text-muted'}`}>
      <div className="flex-1">{children}</div>
      {onClose && (
        <button className="shrink-0 text-muted hover:text-foreground" onClick={onClose} aria-label="Dismiss">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

export function CoachPage() {
  const { snapshot, profile, settings, saveSettings } = useApp();
  const firstName = profile?.displayName?.trim().split(/\s+/)[0] || 'there';
  const nextId = useRef(1);
  const [msgs, setMsgs] = useState<Msg[]>(() => [
    { id: 0, role: 'coach', source: 'rule-based', text: `Hey ${firstName}! I'm your training coach. Ask me about your workouts, nutrition, recovery, or race preparation. What's on your mind?` },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [waking, setWaking] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [noticeDismissed, setNoticeDismissed] = useState(() => readFlag(NOTICE_KEY));
  const [quota, setQuota] = useState(getRemainingQuestions);
  // Is there a coach server? A configured URL counts; otherwise ask this site (npm start serves both).
  const [aiAvailable, setAiAvailable] = useState<'checking' | 'yes' | 'no'>(() => (hasCoachUrl(settings) ? 'yes' : 'checking'));
  const warm = useRef(false); // the server has answered once this session
  const endRef = useRef<HTMLDivElement>(null);

  const aiPreferred = Boolean(settings?.aiCoachEnabled);
  const limitReached = quota.remaining <= 0;
  const mode: 'rule' | 'ai' = aiPreferred && online && aiAvailable === 'yes' && !limitReached ? 'ai' : 'rule';
  const userAsked = msgs.some((m) => m.role === 'user');

  useEffect(() => {
    if (hasCoachUrl(settings)) {
      setAiAvailable('yes');
      return;
    }
    let live = true;
    checkCoachHealth(settings, 5000).then((h) => live && setAiAvailable(h.available ? 'yes' : 'no'));
    return () => {
      live = false;
    };
  }, [settings]);

  // In AI mode, nudge a sleeping server awake before the first question arrives.
  useEffect(() => {
    if (mode !== 'ai' || warm.current) return;
    checkCoachHealth(settings).then((h) => {
      if (h.available) warm.current = true;
    });
  }, [mode, settings]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const tick = window.setInterval(() => setQuota(getRemainingQuestions()), 30_000);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, busy]);

  const push = (m: Omit<Msg, 'id'>) => setMsgs((list) => [...list, { ...m, id: nextId.current++ }]);

  const send = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q || busy) return;
    setInput('');
    const history: CoachTurn[] = msgs
      .filter((m) => m.id !== 0)
      .slice(-8)
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text }));
    push({ role: 'user', text: q });
    setBusy(true);
    if (mode === 'ai' && !warm.current) setWaking(true);
    const res = await askCoach(q, mode, snapshot, { settings, history });
    if (res.source === 'ai') warm.current = true;
    setWaking(false);
    setBusy(false);
    push({ role: 'coach', ...res });
    setQuota(getRemainingQuestions());
  }, [busy, mode, msgs, snapshot, settings]);

  const weeklyReport = () => {
    const r = generateWeeklyReport(snapshot);
    const text = [
      `**Weekly report, ${r.weekStart} to ${r.weekEnd}**`,
      `- Sessions: ${r.planned.completed}/${r.planned.total} completed${r.planned.missed ? `, ${r.planned.missed} missed` : ''}`,
      `- Running: ${r.running.actualKm} km actual vs ${r.running.plannedKm} km planned`,
      `- Strength sessions: ${r.strengthSessions}`,
      `- Nutrition: ${r.nutrition.daysLogged} days logged${r.nutrition.avgProtein ? `, about ${r.nutrition.avgProtein} g protein a day` : ''}`,
      `- Sleep: ${r.avgSleepHours !== undefined ? `${r.avgSleepHours} h average` : 'no data'}. Steps: ${r.stepsAvg !== undefined ? `${r.stepsAvg} a day` : 'no data'}`,
      r.recovery.concerns.length ? `- Recovery: ${r.recovery.concerns.join(' ')}` : '',
      r.improvements.length ? `\nGoing well: ${r.improvements.join(' ')}` : '',
      r.setbacks.length ? `Watch: ${r.setbacks.join(' ')}` : '',
      `\n**Next week**\n${r.priorities.map((p) => `- ${p}`).join('\n')}`,
    ].filter(Boolean).join('\n');
    push({ role: 'user', text: 'Generate my weekly report' });
    push({ role: 'coach', text, source: 'rule-based', tags: ['calculation'] });
  };

  const chooseMode = async (next: 'rule' | 'ai') => {
    if (!settings || (next === 'ai') === aiPreferred) return;
    await saveSettings({ ...settings, aiCoachEnabled: next === 'ai' });
  };
  const dismissNotice = () => {
    setNoticeDismissed(true);
    try {
      localStorage.setItem(NOTICE_KEY, '1');
    } catch {
      /* private mode: the notice just shows again next time */
    }
  };

  const aiDisabled = aiAvailable !== 'yes';
  return (
    <div className="flex min-h-[calc(100dvh-9rem)] flex-col">
      <AppHeader
        title="My Athlete Coach"
        subtitle={mode === 'ai' ? <>Answers by <Highlight>AI</Highlight>, grounded in your logs.</> : <>Answers from <Highlight>your own logs</Highlight>, on this device.</>}
      />

      <div className="mb-3">
        <div title={aiDisabled ? (aiAvailable === 'checking' ? 'Checking for the AI coach' : 'AI coach is not configured') : undefined}>
          <Segmented
            value={aiPreferred && !aiDisabled ? 'ai' : 'rule'}
            onChange={(v) => {
              if (v === 'ai' && aiDisabled) return;
              void chooseMode(v);
            }}
            options={[{ value: 'rule', label: 'Rule-based' }, { value: 'ai', label: aiDisabled ? 'AI (not set up)' : 'AI' }]}
            label="Coach mode"
          />
        </div>
        {aiPreferred && !aiDisabled && online && (
          <p className="mt-1.5 text-xs text-muted" aria-live="polite">
            {limitReached
              ? `Switched to rule-based (limit reached). AI is back in ${quota.resetInMinutes} min.`
              : `${quota.remaining} question${quota.remaining === 1 ? '' : 's'} remaining this hour`}
          </p>
        )}
      </div>

      {aiPreferred && !aiDisabled && !noticeDismissed && (
        <Notice onClose={dismissNotice}>AI mode sends your training summary to our server. Your detailed health data stays on your device.</Notice>
      )}
      {aiPreferred && !online && (
        <Notice tone="warn"><span className="inline-flex items-center gap-1.5"><WifiOff className="h-3.5 w-3.5" aria-hidden /> You're offline. Using rule-based coach.</span></Notice>
      )}

      <div className="flex-1 space-y-3 pb-3" aria-live="polite">
        {msgs.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-3.5 py-2.5 text-sm ${m.role === 'user' ? 'whitespace-pre-line rounded-xl rounded-br-sm bg-secondary' : 'card rounded-bl-sm'}`}>
              {m.role === 'user' ? m.text : <Markdown text={m.text} />}
              {m.role === 'coach' && m.source === 'ai-fallback' && (
                <p className="mt-2 text-xs text-muted">AI coach is unavailable{m.fallbackReason ? ` (${m.fallbackReason})` : ''}. Using rule-based answers.</p>
              )}
              {m.role === 'coach' && m.id !== 0 && m.source && (
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className={`pill ${m.source === 'ai' ? 'border-accent/40 text-accent' : 'border-border text-muted'}`}>{SOURCE_LABEL[m.source]}</span>
                  {m.tags?.map((t) => <span key={t} className={`pill ${TAG_STYLE[t] ?? 'border-border text-muted'}`}>{t}</span>)}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start" role="status" aria-label="Coach is typing">
            <div className="card px-3.5 py-3 text-sm">
              {waking && <p className="mb-2 text-xs text-muted motion-safe:animate-pulse">Waking up the AI coach… this can take up to 50 seconds on the first request.</p>}
              <span className="flex gap-1" aria-hidden>
                {[0, 150, 300].map((d) => <span key={d} className="h-1.5 w-1.5 rounded-full bg-foreground/50 motion-safe:animate-pulse" style={{ animationDelay: `${d}ms` }} />)}
              </span>
            </div>
          </div>
        )}
        {!userAsked && (
          <>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {QUICK_QUESTIONS.map((s) => <Chip key={s} onClick={() => void send(s)}>{s}</Chip>)}
            </div>
            <button className="btn-ghost w-full" onClick={weeklyReport}>
              <ClipboardList className="h-4 w-4" aria-hidden /> Generate weekly report
            </button>
          </>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="sticky bottom-16 flex gap-2 bg-background/90 pb-2 pt-2 backdrop-blur-md"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input className="field" value={input} onChange={(e) => setInput(e.target.value)} placeholder={mode === 'ai' ? 'Ask AI coach…' : 'Ask your coach…'} aria-label="Ask your coach" disabled={busy} maxLength={2000} />
        <button type="submit" className="btn-solid shrink-0" disabled={busy || !input.trim()} aria-label="Send">
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </div>
  );
}
