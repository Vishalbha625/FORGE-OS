import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Sparkles, Utensils } from 'lucide-react';
import { useApp, newRecord } from '../../store/AppContext';
import { useLog } from '../../features/logging/QuickLog';
import { useToast } from '../../store/toast';
import { useConfirmDelete, useConfirmDuplicate } from '../../store/confirm';
import { AppHeader } from '../../components/Layout';
import { Bar, Card, Chip, EmptyState, Highlight, IconButton, InfoNote, Ring, SectionTitle } from '../../components/ui';
import { estimateNutrition, round0 } from '../../lib/calc';
import { answerQuestion } from '../../lib/coach';
import { addDays, fmtDate, todayISO } from '../../lib/dates';
import type { NutritionEntry } from '../../db/types';

const MEALS: NutritionEntry['meal'][] = ['breakfast', 'lunch', 'dinner', 'snack'];

export function Nutrition() {
  const { profile, data, snapshot, remove, saveProfile } = useApp();
  const log = useLog();
  const toast = useToast();
  const confirmDelete = useConfirmDelete();
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
      <AppHeader title="Nutrition" subtitle={<>Your <Highlight>{profile.diet}</Highlight> food log, targets and hydration.</>} />

      {/* Date nav */}
      <div className="mb-3 flex items-center justify-between">
        <IconButton label="Previous day" onClick={() => setDate(addDays(date, -1))}><ChevronLeft className="h-4 w-4" aria-hidden /></IconButton>
        <div className="text-sm font-medium">{date === todayISO() ? 'Today' : fmtDate(date, { weekday: 'short' })}</div>
        <IconButton label="Next day" onClick={() => setDate(addDays(date, 1))} className={date >= todayISO() ? 'pointer-events-none opacity-30' : ''}><ChevronRight className="h-4 w-4" aria-hidden /></IconButton>
      </div>

      {/* Targets summary */}
      {!calTarget ? (
        <Card className="mb-3">
          {est.canEstimate ? (
            <>
              <div className="font-semibold text-sm mb-1">Set your nutrition targets</div>
              <p className="text-xs text-muted mb-2">Estimated for you: <b>{est.calories} kcal</b>, {est.protein}g protein, {est.carbs}g carbs, {est.fat}g fat. These are estimates, not measurements, and you can edit them.</p>
              <button className="btn-soft w-full" onClick={applyEstimate}>Apply estimated targets</button>
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
                <div className="font-montserrat text-base font-semibold">{round0(totals.cal)}</div>
                <div className="text-[9px] text-muted">/{calTarget}</div>
              </div>
            </Ring>
            <div className="flex-1 space-y-2">
              <MacroBar label="Protein" val={totals.prot} target={protTarget ?? 0} unit="g" />
              <MacroBar label="Carbs" val={totals.carb} target={profile.carbTarget ?? 0} unit="g" />
              <MacroBar label="Fat" val={totals.fat} target={profile.fatTarget ?? 0} unit="g" />
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
      <SectionTitle action={<button className="btn-outline h-9 px-3" onClick={() => log('meal', { date })}><Plus className="h-4 w-4" aria-hidden /> Add meal</button>}>Meals</SectionTitle>
      <SavedMeals date={date} />
      {dayEntries.filter((e) => !e.isSupplement).length === 0 ? (
        <EmptyState title="Nothing logged for this day" hint="Add a meal, or tap a saved one above." icon={Utensils} />
      ) : (
        MEALS.map((m) => {
          const items = dayEntries.filter((e) => e.meal === m);
          if (!items.length) return null;
          const mealCal = round0(items.reduce((a, e) => a + (e.calories ?? 0), 0));
          return (
            <div key={m} className="mb-3">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-sm font-medium capitalize text-foreground/80">{m}</span>
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
                      <div className="flex gap-3 shrink-0 ml-2">
                        <button className="link" onClick={() => log('meal', { existing: e })}>Edit</button>
                        <button className="text-muted text-xs" onClick={async () => { if (await confirmDelete(`"${e.name}" from ${e.meal}`)) remove('nutrition', e.id); }}>Delete</button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          );
        })
      )}

      {/* Water + supplements */}
      <SectionTitle action={<button className="link" onClick={() => log('water')}>Add water</button>}>Hydration</SectionTitle>
      <Card className="mb-3">
        <div className="flex items-center justify-between">
          <span className="text-sm">{(water / 1000).toFixed(1)} L of {(profile.waterTargetMl / 1000).toFixed(1)} L</span>
          <span className="font-montserrat text-sm font-semibold">{Math.round((water / profile.waterTargetMl) * 100)}%</span>
        </div>
        <div className="mt-2"><Bar pct={(water / profile.waterTargetMl) * 100} label="Water of target" /></div>
      </Card>

      <Supplements date={date} />
      <div className="h-6" />
    </div>
  );
}

function SavedMeals({ date }: { date: string }) {
  const { settings, saveSettings, save, data } = useApp();
  const toast = useToast();
  const [manage, setManage] = useState(false);
  const confirmDup = useConfirmDuplicate();
  const saved = settings?.savedMeals ?? [];
  if (!settings || !saved.length) return null;

  const quickLog = async (id: string) => {
    const m = saved.find((x) => x.id === id);
    if (!m) return;
    const dup = data.nutrition.find((e) => e.eventDate === date && e.meal === m.meal && e.name.toLowerCase() === m.name.toLowerCase());
    if (dup && !(await confirmDup(`"${m.name}" is already logged for ${m.meal} on this day. Log it again?`))) return;
    const rec = newRecord({
      eventDate: date, source: 'manual', meal: m.meal, name: m.name, servingSize: m.servingSize,
      calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat, fiber: m.fiber,
    }) as NutritionEntry;
    await save('nutrition', rec);
    toast(`${m.name} logged`);
  };
  const removeSaved = async (id: string) => {
    await saveSettings({ ...settings, savedMeals: saved.filter((m) => m.id !== id) });
  };

  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-sm font-medium text-foreground/80">Saved meals, tap to log</span>
        <button className="link" onClick={() => setManage((v) => !v)}>{manage ? 'Done' : 'Manage'}</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {saved.map((m) => (
          <Chip key={m.id} onClick={() => (manage ? removeSaved(m.id) : quickLog(m.id))}>
            {manage ? 'Remove ' : ''}{m.name}{m.calories ? ` · ${m.calories}` : ''}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function MacroBar({ label, val, target, unit }: { label: string; val: number; target: number; unit: string }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] mb-0.5">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums">{round0(val)}{target ? ` / ${target}` : ''} {unit}</span>
      </div>
      <Bar pct={target ? (val / target) * 100 : 0} height={5} label={`${label} of target`} />
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
    <Card className="mt-3">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium"><Sparkles className="h-4 w-4 text-highlight" aria-hidden /> Ask My Nutrition Coach</div>
      <div className="mb-2 flex gap-2">
        <input className="field py-2 text-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your food log" aria-label="Ask the nutrition coach" onKeyDown={(e) => e.key === 'Enter' && q && ask(q)} />
        <button className="btn-soft" onClick={() => q && ask(q)}>Ask</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s) => <Chip key={s} onClick={() => ask(s)}>{s}</Chip>)}
      </div>
      {a && <div className="mt-3 whitespace-pre-line rounded-lg border border-border p-3 text-sm" aria-live="polite">{a}</div>}
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
            {s.name}{s.serving ? ` (${s.serving})` : ''}
          </Chip>
        ))}
      </div>
      <InfoNote>Supplements are tracked separately from food. Forge OS doesn't prescribe doses or timing: follow the product label and professional advice.</InfoNote>
    </>
  );
}
