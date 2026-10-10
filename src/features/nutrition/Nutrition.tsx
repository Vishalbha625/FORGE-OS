import { useMemo, useState } from 'react';
import { useApp, newRecord } from '../../store/AppContext';
import { useLog } from '../../features/logging/QuickLog';
import { useToast } from '../../store/toast';
import { AppHeader } from '../../components/Layout';
import { Card, SectionTitle, Ring, Bar, EmptyState, InfoNote, Chip } from '../../components/ui';
import { estimateNutrition, round0 } from '../../lib/calc';
import { answerQuestion } from '../../lib/coach';
import { addDays, fmtDate, todayISO } from '../../lib/dates';
import type { NutritionEntry } from '../../db/types';

const MEALS: NutritionEntry['meal'][] = ['breakfast', 'lunch', 'dinner', 'snack'];

export function Nutrition() {
  const { profile, data, snapshot, remove, saveProfile } = useApp();
  const log = useLog();
  const toast = useToast();
  const [date, setDate] = useState(todayISO());

  const dayEntries = useMemo(() => data.nutrition.filter((n) => n.eventDate === date), [data.nutrition, date]);
  const totals = useMemo(() => dayEntries.reduce(
    (a, n) => ({
      cal: a.cal + (n.calories ?? 0),
      prot: a.prot + (n.protein ?? 0),
      carb: a.carb + (n.carbs ?? 0),
      fat: a.fat + (n.fat ?? 0),
      fiber: a.fiber + (n.fiber ?? 0),
    }),
    { cal: 0, prot: 0, carb: 0, fat: 0, fiber: 0 },
  ), [dayEntries]);

  const water = round0(data.water.filter((w) => w.eventDate === date).reduce((a, w) => a + w.amountMl, 0));

  if (!profile) return null;
  const est = estimateNutrition(profile);
  const calTarget = profile.calorieTarget;
  const protTarget = profile.proteinTarget;

  const applyEstimate = async () => {
    if (!est.canEstimate) return;
    await saveProfile({ ...profile, calorieTarget: est.calories, proteinTarget: est.protein, carbTarget: est.carbs, fatTarget: est.fat });
    toast('Targets applied');
  };

  return (
    <div>
      <AppHeader title="Nutrition" subtitle={profile.diet} />

      {/* Date nav */}
      <div className="flex items-center justify-between mb-3">
        <button className="btn-ghost px-3 py-2" onClick={() => setDate(addDays(date, -1))}>‹</button>
        <div className="font-semibold text-sm">{date === todayISO() ? 'Today' : fmtDate(date, { weekday: 'short' })}</div>
        <button className="btn-ghost px-3 py-2 disabled:opacity-30" disabled={date >= todayISO()} onClick={() => setDate(addDays(date, 1))}>›</button>
      </div>

      {/* Targets summary */}
      {!calTarget ? (
        <Card className="mb-3">
          {est.canEstimate ? (
            <>
              <div className="font-semibold text-sm mb-1">Set your nutrition targets</div>
              <p className="text-xs text-muted mb-2">Estimated for you: <b>{est.calories} kcal</b>, {est.protein}g protein, {est.carbs}g carbs, {est.fat}g fat. These are estimates, not exact — you can edit them.</p>
              <button className="btn-primary w-full py-2.5 text-sm" onClick={applyEstimate}>Apply estimated targets</button>
            </>
          ) : (
            <InfoNote tone="warn">Add {est.missing.join(', ')} in your profile to estimate nutrition targets. Until then, logs still total correctly.</InfoNote>
          )}
        </Card>
      ) : (
        <Card className="mb-3">
          <div className="flex items-center gap-4">
            <Ring pct={(totals.cal / calTarget) * 100} size={76} stroke={8}>
              <div className="text-center leading-tight">
                <div className="text-base font-extrabold">{round0(totals.cal)}</div>
                <div className="text-[9px] text-muted">/{calTarget}</div>
              </div>
            </Ring>
            <div className="flex-1 space-y-2">
              <MacroBar label="Protein" val={totals.prot} target={protTarget ?? 0} color="#3ecf8e" unit="g" />
              <MacroBar label="Carbs" val={totals.carb} target={profile.carbTarget ?? 0} color="#5aa9ff" unit="g" />
              <MacroBar label="Fat" val={totals.fat} target={profile.fatTarget ?? 0} color="#f5b945" unit="g" />
            </div>
          </div>
          <div className="flex justify-between mt-3 text-xs text-muted">
            <span>Remaining: {round0(calTarget - totals.cal)} kcal</span>
            <span>Fibre: {round0(totals.fiber)} g</span>
          </div>
        </Card>
      )}

      {/* Nutrition coach */}
      <NutritionCoach snapshot={snapshot} />

      {/* Meals */}
      <div className="flex items-center justify-between mt-4 mb-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Meals</h2>
        <button className="btn-primary px-4 py-2 text-sm" onClick={() => log('meal')}>+ Add meal</button>
      </div>
      {dayEntries.length === 0 ? (
        <EmptyState title="Nothing logged" hint="Add your first meal for this day." icon="🍽️" />
      ) : (
        MEALS.map((m) => {
          const items = dayEntries.filter((e) => e.meal === m);
          if (!items.length) return null;
          const mealCal = round0(items.reduce((a, e) => a + (e.calories ?? 0), 0));
          return (
            <div key={m} className="mb-3">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted capitalize">{m}</span>
                <span className="text-xs text-muted">{mealCal} kcal</span>
              </div>
              <div className="space-y-1.5">
                {items.map((e) => (
                  <Card key={e.id} className="py-2.5">
                    <div className="flex justify-between items-center">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{e.name}</div>
                        <div className="text-xs text-muted">{e.servingSize ?? ''} {e.calories ? `· ${e.calories} kcal` : ''} {e.protein ? `· ${e.protein}p` : ''}{e.carbs ? ` · ${e.carbs}c` : ''}{e.fat ? ` · ${e.fat}f` : ''}</div>
                      </div>
                      <button className="text-muted text-xs shrink-0 ml-2" onClick={() => { if (confirm('Delete this entry?')) remove('nutrition', e.id); }}>Delete</button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          );
        })
      )}

      {/* Water + supplements */}
      <SectionTitle action={<button className="text-xs text-accent font-semibold" onClick={() => log('water')}>+ Add</button>}>Hydration</SectionTitle>
      <Card className="mb-3">
        <div className="flex items-center justify-between">
          <span className="text-sm">{(water / 1000).toFixed(1)} L of {(profile.waterTargetMl / 1000).toFixed(1)} L</span>
          <span className="text-sm font-bold text-info">{Math.round((water / profile.waterTargetMl) * 100)}%</span>
        </div>
        <div className="mt-2"><Bar pct={(water / profile.waterTargetMl) * 100} color="#5aa9ff" /></div>
      </Card>

      <Supplements date={date} />
      <div className="h-6" />
    </div>
  );
}

function MacroBar({ label, val, target, color, unit }: { label: string; val: number; target: number; color: string; unit: string }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] mb-0.5">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums">{round0(val)}{target ? `/${target}` : ''}{unit}</span>
      </div>
      <Bar pct={target ? (val / target) * 100 : 0} color={color} height={6} />
    </div>
  );
}

function NutritionCoach({ snapshot }: { snapshot: ReturnType<typeof useApp>['snapshot'] }) {
  const [q, setQ] = useState('');
  const [a, setA] = useState<string | null>(null);
  const suggestions = ['What should I eat after a long run?', 'How much protein have I logged today?', 'Meet my protein target with veg food'];

  const ask = (question: string) => {
    setQ(question);
    const ans = answerQuestion(question, snapshot);
    setA(ans.text);
  };

  return (
    <Card className="mb-3 bg-gradient-to-br from-surface to-surface-2">
      <div className="font-semibold text-sm mb-1 flex items-center gap-1.5">✦ Ask My Nutrition Coach</div>
      <div className="flex gap-2 mb-2">
        <input className="field py-2 text-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your food log…" onKeyDown={(e) => e.key === 'Enter' && q && ask(q)} />
        <button className="btn-primary px-4 text-sm" onClick={() => q && ask(q)}>Ask</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s) => <Chip key={s} onClick={() => ask(s)}>{s}</Chip>)}
      </div>
      {a && <div className="text-sm mt-3 whitespace-pre-line bg-surface-2 rounded-xl p-3 border border-line">{a}</div>}
    </Card>
  );
}

function Supplements({ date }: { date: string }) {
  const { profile, data, save, remove } = useApp();
  const toast = useToast();
  if (!profile || profile.supplements.filter((s) => s.active).length === 0) return null;

  const takenToday = (name: string) => data.nutrition.find((n) => n.eventDate === date && n.isSupplement && n.name === name);

  const toggle = async (name: string, serving?: string) => {
    const existing = takenToday(name);
    if (existing) {
      await remove('nutrition', existing.id);
      toast('Removed');
    } else {
      const rec = newRecord<Omit<NutritionEntry, 'id' | 'createdAt' | 'updatedAt'>>({
        eventDate: date, source: 'manual', meal: 'supplement', name, servingSize: serving, isSupplement: true,
      }) as NutritionEntry;
      await save('nutrition', rec);
      toast('Logged');
    }
  };

  return (
    <>
      <SectionTitle>Supplements</SectionTitle>
      <div className="flex flex-wrap gap-2 mb-3">
        {profile.supplements.filter((s) => s.active).map((s) => (
          <Chip key={s.name} active={!!takenToday(s.name)} onClick={() => toggle(s.name, s.serving)}>
            {takenToday(s.name) ? '✓ ' : ''}{s.name}{s.serving ? ` (${s.serving})` : ''}
          </Chip>
        ))}
      </div>
      <InfoNote>Supplements are tracked separately from food. Dosage/timing guidance isn't prescribed here — follow product labels and professional advice.</InfoNote>
    </>
  );
}
