import { useRef, useState, useEffect } from 'react';
import { useApp } from '../../store/AppContext';
import { AppHeader } from '../../components/Layout';
import { Chip, InfoNote } from '../../components/ui';
import { answerQuestion, generateWeeklyReport } from '../../lib/coach';
import { buildCoachContext } from '../../lib/coachContext';

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
  fact: 'bg-good/15 text-good',
  calculation: 'bg-info/15 text-info',
  estimate: 'bg-warn/15 text-warn',
  suggestion: 'bg-accent/15 text-accent',
  missing: 'bg-muted/20 text-muted',
  'AI · Claude': 'bg-accent/15 text-accent',
  'rule-based': 'bg-surface-2 text-muted',
};

async function askServer(question: string, context: unknown, history: { role: 'user' | 'assistant'; text: string }[]) {
  const res = await fetch('/api/coach', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, context, history }),
  });
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
    { role: 'coach', text: `Hi ${profile?.displayName?.split(' ')[0] ?? ''}! I'm your Athlete Coach. I answer from your logged data only — I won't invent workouts, meals or metrics. Ask me anything, or tap a suggestion.`, tags: ['suggestion'] },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

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
        const answer = await askServer(q, buildCoachContext(snapshot), history);
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
      `📋 Weekly report (${r.weekStart} – ${r.weekEnd})`,
      `• Sessions: ${r.planned.completed}/${r.planned.total} completed${r.planned.missed ? `, ${r.planned.missed} missed` : ''}`,
      `• Running: ${r.running.actualKm} km actual vs ${r.running.plannedKm} km planned`,
      `• Strength sessions: ${r.strengthSessions}`,
      `• Nutrition: ${r.nutrition.daysLogged} days logged${r.nutrition.avgProtein ? `, ~${r.nutrition.avgProtein}g protein/day` : ''}`,
      `• Sleep: ${r.avgSleepHours !== undefined ? r.avgSleepHours + ' h avg' : 'no data'} · Steps: ${r.stepsAvg !== undefined ? r.stepsAvg + '/day' : 'no data'}`,
      r.recovery.concerns.length ? `• Recovery: ${r.recovery.concerns.join(' ')}` : '',
      r.improvements.length ? `✅ ${r.improvements.join(' ')}` : '',
      r.setbacks.length ? `⚠️ ${r.setbacks.join(' ')}` : '',
      `\n🎯 Next week:\n${r.priorities.map((p, i) => `${i + 1}. ${p}`).join('\n')}`,
    ].filter(Boolean).join('\n');
    setMsgs((m) => [...m, { role: 'user', text: 'Generate my weekly report' }, { role: 'coach', text, tags: ['calculation'] }]);
  };

  const toggleAi = async () => {
    if (!settings) return;
    if (!aiOn && !confirm('Turn on the AI coach?\n\nYour questions and a summary of your last 4 weeks of logs (no photos) will be sent to the Forge OS server you run, which forwards them to Anthropic\'s API. You need to run `npm start` with an ANTHROPIC_API_KEY. You can turn this off any time.')) return;
    await saveSettings({ ...settings, aiCoachEnabled: !aiOn });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      <AppHeader title="My Athlete Coach" subtitle={aiOn ? 'AI mode · Claude via your server' : 'Rule-based mode · fully offline'} />

      <div className="flex items-center justify-between mb-2 text-xs">
        <span className="text-muted">{aiOn ? 'Sends a summary of your data to your coach server.' : 'Nothing leaves this device.'}</span>
        <button onClick={toggleAi} className={`btn-chip ${aiOn ? 'bg-accent text-black border-accent' : 'bg-surface-2 text-text border-line'}`}>
          {aiOn ? 'AI on' : 'Use AI'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pb-3">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-line ${m.role === 'user' ? 'bg-accent text-black rounded-br-sm' : 'bg-surface border border-line rounded-bl-sm'}`}>
              {m.text}
              {m.role === 'coach' && m.tags && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {m.tags.map((t) => <span key={t} className={`pill ${TAG_STYLE[t] ?? 'bg-surface-2 text-muted'}`}>{t}</span>)}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-3.5 py-2.5 text-sm bg-surface border border-line text-muted animate-pulse">Thinking about your data…</div>
          </div>
        )}
        {msgs.length <= 1 && (
          <>
            <button className="btn-ghost w-full" onClick={weeklyReport}>📋 Generate weekly report</button>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {SUGGESTIONS.map((s) => <Chip key={s} onClick={() => send(s)}>{s}</Chip>)}
            </div>
            <InfoNote>Rule-based answers are tagged <b>fact</b> (your logged data), <b>calculation</b>, <b>estimate</b>, <b>suggestion</b>, or <b>missing</b> (not enough data). AI answers are tagged <b>AI · Claude</b>; they're grounded in your logs and cite dates.</InfoNote>
          </>
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 bg-bg pt-2 pb-safe">
        {msgs.length > 1 && (
          <div className="flex gap-1.5 mb-2 overflow-x-auto">
            {SUGGESTIONS.slice(0, 6).map((s) => <span key={s} className="shrink-0"><Chip onClick={() => send(s)}>{s}</Chip></span>)}
          </div>
        )}
        <div className="flex gap-2">
          <input className="field" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask your coach…" onKeyDown={(e) => e.key === 'Enter' && send(input)} disabled={busy} />
          <button className="btn-primary px-5" onClick={() => send(input)} disabled={busy}>Send</button>
        </div>
      </div>
    </div>
  );
}
