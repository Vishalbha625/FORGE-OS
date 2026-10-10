import { useRef, useState, useEffect } from 'react';
import { useApp } from '../../store/AppContext';
import { AppHeader } from '../../components/Layout';
import { Chip, InfoNote } from '../../components/ui';
import { answerQuestion, generateWeeklyReport, type CoachAnswer } from '../../lib/coach';

interface Msg { role: 'user' | 'coach'; text: string; tags?: string[] }

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
};

export function Coach() {
  const { snapshot, profile } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: 'coach', text: `Hi ${profile?.displayName?.split(' ')[0] ?? ''}! I'm your Athlete Coach. I answer from your logged data only — I won't invent workouts, meals or metrics. Ask me anything, or tap a suggestion.`, tags: ['suggestion'] },
  ]);
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  const send = (text: string) => {
    if (!text.trim()) return;
    const ans: CoachAnswer = answerQuestion(text, snapshot);
    setMsgs((m) => [...m, { role: 'user', text }, { role: 'coach', text: ans.text, tags: ans.tags }]);
    setInput('');
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

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      <AppHeader title="My Athlete Coach" subtitle="Data-backed, honest about gaps" />

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
        {msgs.length <= 1 && (
          <>
            <button className="btn-ghost w-full" onClick={weeklyReport}>📋 Generate weekly report</button>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {SUGGESTIONS.map((s) => <Chip key={s} onClick={() => send(s)}>{s}</Chip>)}
            </div>
            <InfoNote>Tags show how to read each answer: <b>fact</b> (your logged data), <b>calculation</b> (computed), <b>estimate</b>, <b>suggestion</b>, or <b>missing</b> (not enough data).</InfoNote>
          </>
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 bg-bg pt-2 pb-safe">
        {msgs.length > 1 && (
          <div className="flex gap-1.5 mb-2 overflow-x-auto no-scrollbar">
            {SUGGESTIONS.slice(0, 6).map((s) => <Chip key={s} onClick={() => send(s)}>{s}</Chip>)}
          </div>
        )}
        <div className="flex gap-2">
          <input className="field" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask your coach…" onKeyDown={(e) => e.key === 'Enter' && send(input)} />
          <button className="btn-primary px-5" onClick={() => send(input)}>Send</button>
        </div>
      </div>
    </div>
  );
}
