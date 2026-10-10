import { useRef, useState, useEffect } from 'react';
import { ClipboardList, Send } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { AppHeader } from '../../components/Layout';
import { Chip, InfoNote, Highlight } from '../../components/ui';
import { useConfirm } from '../../store/confirm';
import { answerQuestion, generateWeeklyReport } from '../../lib/coach';
import { buildCoachContext } from '../../lib/coachContext';
import { coachFetch } from '../../lib/coachApi';
import type { Settings } from '../../db/types';

interface Msg { role: 'user' | 'coach'; text: string; tags?: string[]; ai?: boolean }

const SUGGESTIONS = [
  "What's my workout today?",
  'How many km have I run this week?',
  'Am I on track for HYROX?',
  'How much protein have I consumed today?',
  'What was my last squat weight?',
  'How many hours did I sleep this week?',
  'Have I been recovering adequately?',
  'What are my 3 biggest priorities today?',
  'Summarize my last 7 days',
  'What should I eat after training?',
  'How has my running pace changed?',
  'Compare this month with last month',
];

const TAG_STYLE: Record<string, string> = {
  fact: 'border-good/40 text-good',
  calculation: 'border-border text-foreground/80',
  estimate: 'border-warn/40 text-warn',
  suggestion: 'border-accent/40 text-accent',
  missing: 'border-border text-muted',
  'AI · Claude': 'border-accent/40 text-accent',
  'rule-based': 'border-border text-muted',
};

async function askServer(settings: Settings | null, question: string, context: unknown, history: { role: 'user' | 'assistant'; text: string }[]) {
  let res: Response;
  try {
    res = await coachFetch(settings, '/api/coach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, context, history }),
    });
  } catch {
    // Network error, or the browser blocked a cross-origin call (CORS).
    throw new Error('could not reach the coach server');
  }
  let body: { answer?: string; error?: string } = {};
  try {
    body = await res.json();
  } catch {
    throw new Error(res.status === 404 ? 'no coach server running' : `server returned ${res.status}`);
  }
  if (!res.ok || !body.answer) throw new Error(body.error ?? `server returned ${res.status}`);
  return body.answer;
}

export function Coach() {
  const { snapshot, profile, settings, saveSettings } = useApp();
  const aiOn = !!settings?.aiCoachEnabled;
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: 'coach', text: `Hi ${profile?.displayName?.split(' ')[0] ?? ''}! I'm your Athlete Coach. I answer from your logged data only, I won't invent workouts, meals or metrics. Ask me anything, or tap a suggestion.`, tags: ['suggestion'] },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text: q }]);

    if (aiOn) {
      setBusy(true);
      try {
        const history = msgs.slice(1).slice(-8).map((m) => ({ role: m.role === 'user' ? 'user' as const : 'assistant' as const, text: m.text }));
        const answer = await askServer(settings, q, buildCoachContext(snapshot), history);
        setMsgs((m) => [...m, { role: 'coach', text: answer, tags: ['AI · Claude'], ai: true }]);
      } catch (err) {
        const fallback = answerQuestion(q, snapshot);
        const reason = err instanceof Error ? err.message : 'unavailable';
        setMsgs((m) => [...m, { role: 'coach', text: `${fallback.text}\n\n(AI coach unavailable: ${reason}. This answer is from the built-in rule-based coach.)`, tags: [...fallback.tags, 'rule-based'] }]);
      } finally {
        setBusy(false);
      }
      return;
    }

    const ans = answerQuestion(q, snapshot);
    setMsgs((m) => [...m, { role: 'coach', text: ans.text, tags: ans.tags }]);
  };

  const weeklyReport = () => {
    const r = generateWeeklyReport(snapshot);
    const text = [
      `Weekly report, ${r.weekStart} to ${r.weekEnd}`,
      `• Sessions: ${r.planned.completed}/${r.planned.total} completed${r.planned.missed ? `, ${r.planned.missed} missed` : ''}`,
      `• Running: ${r.running.actualKm} km actual vs ${r.running.plannedKm} km planned`,
      `• Strength sessions: ${r.strengthSessions}`,
      `• Nutrition: ${r.nutrition.daysLogged} days logged${r.nutrition.avgProtein ? `, ~${r.nutrition.avgProtein}g protein/day` : ''}`,
      `• Sleep: ${r.avgSleepHours !== undefined ? r.avgSleepHours + ' h avg' : 'no data'} · Steps: ${r.stepsAvg !== undefined ? r.stepsAvg + '/day' : 'no data'}`,
      r.recovery.concerns.length ? `• Recovery: ${r.recovery.concerns.join(' ')}` : '',
      r.improvements.length ? `Going well: ${r.improvements.join(' ')}` : '',
      r.setbacks.length ? `Watch: ${r.setbacks.join(' ')}` : '',
      `\nNext week:\n${r.priorities.map((p, i) => `${i + 1}. ${p}`).join('\n')}`,
    ].filter(Boolean).join('\n');
    setMsgs((m) => [...m, { role: 'user', text: 'Generate my weekly report' }, { role: 'coach', text, tags: ['calculation'] }]);
  };

  const toggleAi = async () => {
    if (!settings) return;
    if (!aiOn && !(await confirm({
      title: 'Turn on the AI coach?',
      description: "Each question, plus a summary of your last 4 weeks of logs (no photos), goes to the Forge OS coach server you run (locally or on a host like Render), which sends it to Anthropic's API. The server needs an ANTHROPIC_API_KEY. You can turn this off any time.",
      confirmLabel: 'Turn on',
      cancelLabel: 'Not now',
    }))) return;
    await saveSettings({ ...settings, aiCoachEnabled: !aiOn });
  };

  return (
    <div className="flex min-h-[calc(100dvh-9rem)] flex-col">
      <AppHeader
        title="My Athlete Coach"
        subtitle={aiOn ? <>Answers by <Highlight>Claude</Highlight>, grounded in your logs.</> : <>Answers from <Highlight>your own logs</Highlight>, fully offline.</>}
      />

      <div className="mb-3 flex items-center justify-between gap-3 text-xs">
        <span className="text-muted">{aiOn ? 'AI mode: sends a summary of your data to your coach server.' : 'Rule-based mode: nothing leaves this device.'}</span>
        <button onClick={toggleAi} className={`btn-chip shrink-0 ${aiOn ? 'chip-on' : 'chip-off'}`} aria-pressed={aiOn}>
          {aiOn ? 'AI on' : 'Use AI'}
        </button>
      </div>

      <div className="flex-1 space-y-3 pb-3" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] whitespace-pre-line px-3.5 py-2.5 text-sm ${m.role === 'user' ? 'rounded-xl rounded-br-sm bg-secondary' : 'card rounded-bl-sm'}`}
            >
              {m.text}
              {m.role === 'coach' && m.tags && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.tags.map((t) => <span key={t} className={`pill ${TAG_STYLE[t] ?? 'border-border text-muted'}`}>{t}</span>)}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="card px-3.5 py-2.5 text-sm text-muted motion-safe:animate-pulse">Reading your data</div>
          </div>
        )}
        {msgs.length <= 1 && (
          <>
            <button className="btn-ghost w-full" onClick={weeklyReport}>
              <ClipboardList className="h-4 w-4" aria-hidden /> Generate weekly report
            </button>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {SUGGESTIONS.map((s) => <Chip key={s} onClick={() => send(s)}>{s}</Chip>)}
            </div>
            <InfoNote>
              Rule-based answers are tagged <b>fact</b> (your logged data), <b>calculation</b>, <b>estimate</b>, <b>suggestion</b> or <b>missing</b> (not enough data). AI answers are tagged <b>AI · Claude</b> and cite the dates of the records they use.
            </InfoNote>
          </>
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-16 bg-background/90 pb-2 pt-2 backdrop-blur-md">
        {msgs.length > 1 && (
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
            {SUGGESTIONS.slice(0, 6).map((s) => <span key={s} className="shrink-0"><Chip onClick={() => send(s)}>{s}</Chip></span>)}
          </div>
        )}
        <div className="flex gap-2">
          <input className="field" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask your coach" aria-label="Ask your coach" onKeyDown={(e) => e.key === 'Enter' && send(input)} disabled={busy} />
          <button className="btn-soft shrink-0" onClick={() => send(input)} disabled={busy} aria-label="Send">
            <Send className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
