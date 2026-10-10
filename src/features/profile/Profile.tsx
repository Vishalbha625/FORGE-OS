import { useRef, useState } from 'react';
import { useApp } from '../../store/AppContext';
import { useToast } from '../../store/toast';
import { AppHeader } from '../../components/Layout';
import { Card, SectionTitle, Field, Sheet, Chip, InfoNote, Segmented } from '../../components/ui';
import { estimateNutrition, cmToFtIn, ageFromDob } from '../../lib/calc';
import { fmtDate } from '../../lib/dates';
import { GOAL_LABELS, DEFAULT_SUPPLEMENTS } from '../../lib/constants';
import type { BackupFile } from '../../db/database';
import type { Profile as P, GoalKey, Reminder, Supplement } from '../../db/types';

const num = (v: string): number | undefined => (v.trim() === '' ? undefined : isNaN(Number(v)) ? undefined : Number(v));

export function Profile() {
  const { profile, settings, saveProfile, regeneratePlan, exportData, importData, resetAll, data } = useApp();
  const toast = useToast();
  const [editProfile, setEditProfile] = useState(false);
  const [editTargets, setEditTargets] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!profile) return null;
  const est = estimateNutrition(profile);

  const doExport = async () => {
    const backup = await exportData();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `forge-os-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup downloaded');
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const file = JSON.parse(text) as BackupFile;
      const mode = confirm('Import mode:\nOK = Merge (keep newer records, no duplicates)\nCancel = Replace all') ? 'merge' : 'replace';
      const res = await importData(file, mode);
      toast(`Imported: +${res.added} added, ${res.updated} updated, ${res.skipped} kept`);
    } catch (err) {
      toast('Invalid backup file');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const totalRecords = Object.values(data).reduce((a, arr) => a + (arr as unknown[]).length, 0);

  return (
    <div>
      <AppHeader title="Profile" subtitle="You & settings" />

      {/* Identity */}
      <Card className="mb-3">
        <div className="flex items-center gap-3">
          <div className="w-16 h-16 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center text-2xl overflow-hidden">{profile.photo ? <img src={profile.photo} className="w-full h-full object-cover" /> : '🏃'}</div>
          <div className="flex-1">
            <div className="font-bold text-lg">{profile.displayName}</div>
            <div className="text-xs text-muted">{profile.age ?? '—'} yrs · {cmToFtIn(profile.heightCm)} · {profile.weightKg ?? '—'} kg</div>
            <div className="text-xs text-muted">{profile.country} · {profile.timezone}</div>
          </div>
          <button className="btn-ghost px-3 py-2 text-sm" onClick={() => setEditProfile(true)}>Edit</button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {profile.goals.map((g) => <span key={g} className={`pill ${g === profile.primaryGoal ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-muted'}`}>{g === profile.primaryGoal ? '★ ' : ''}{GOAL_LABELS[g]}</span>)}
        </div>
      </Card>

      {/* Race / plan */}
      <Card className="mb-3">
        <div className="flex justify-between text-sm"><span className="text-muted">Race</span><span className="font-semibold">{profile.raceDivision}</span></div>
        <div className="flex justify-between text-sm mt-1"><span className="text-muted">Race date</span><span className="font-semibold">{fmtDate(profile.raceDate)}</span></div>
        <div className="flex justify-between text-sm mt-1"><span className="text-muted">Training start</span><span className="font-semibold">{fmtDate(profile.trainingStartDate)}</span></div>
        <div className="flex justify-between text-sm mt-1"><span className="text-muted">Planned sessions</span><span className="font-semibold">{data.plannedWorkouts.length}</span></div>
        <button className="btn-ghost w-full mt-3 py-2.5 text-sm" onClick={async () => { if (confirm('Regenerate the training plan from your start date to race day? Your logged (actual) workouts are never touched — only the planned calendar is rebuilt.')) { await regeneratePlan(profile.trainingStartDate, profile.raceDate); toast('Plan regenerated'); } }}>Regenerate plan</button>
      </Card>

      {/* Nutrition targets */}
      <SectionTitle action={<button className="text-xs text-accent font-semibold" onClick={() => setEditTargets(true)}>Edit</button>}>Nutrition targets</SectionTitle>
      <Card className="mb-3">
        {profile.calorieTarget ? (
          <div className="grid grid-cols-4 text-center gap-1">
            <div><div className="font-extrabold">{profile.calorieTarget}</div><div className="text-[10px] text-muted">kcal</div></div>
            <div><div className="font-extrabold">{profile.proteinTarget ?? '—'}</div><div className="text-[10px] text-muted">protein</div></div>
            <div><div className="font-extrabold">{profile.carbTarget ?? '—'}</div><div className="text-[10px] text-muted">carbs</div></div>
            <div><div className="font-extrabold">{profile.fatTarget ?? '—'}</div><div className="text-[10px] text-muted">fat</div></div>
          </div>
        ) : (
          <div className="text-sm text-muted">No targets set. {est.canEstimate ? `Estimated: ${est.calories} kcal / ${est.protein}g protein.` : `Add ${est.missing.join(', ')} to estimate.`}</div>
        )}
      </Card>

      {/* Supplements */}
      <SectionTitle>Supplements</SectionTitle>
      <Card className="mb-3">
        <div className="flex flex-wrap gap-1.5">
          {DEFAULT_SUPPLEMENTS.map((s) => {
            const active = profile.supplements.some((x) => x.name === s.name && x.active);
            return <Chip key={s.name} active={active} onClick={async () => {
              const exists = profile.supplements.find((x) => x.name === s.name);
              let supps: Supplement[];
              if (exists) supps = profile.supplements.map((x) => x.name === s.name ? { ...x, active: !x.active } : x);
              else supps = [...profile.supplements, { ...s }];
              await saveProfile({ ...profile, supplements: supps });
            }}>{active ? '✓ ' : ''}{s.name}</Chip>;
          })}
        </div>
      </Card>

      {/* Settings */}
      {settings && <SettingsSection />}

      {/* Integrations */}
      <SectionTitle>Device integrations</SectionTitle>
      {settings?.integrations.map((i) => (
        <Card key={i.key} className="mb-2 flex items-center justify-between py-3">
          <div><div className="font-semibold text-sm">{i.label}</div><div className="text-xs text-muted">{i.provides}</div></div>
          <span className="pill bg-muted/15 text-muted">Not available</span>
        </Card>
      ))}
      <InfoNote tone="warn">No device integration is active yet. These need platform-specific APIs/OAuth (Apple Health & Health Connect require a native app; Garmin/Fitbit/Strava require developer API access & your authorization). Until connected, data is manual and labelled as such — never faked.</InfoNote>
      <div className="h-3" />

      {/* Data management */}
      <SectionTitle>Data & backup</SectionTitle>
      <Card className="mb-3">
        <div className="text-sm text-muted mb-2">{totalRecords} records stored locally (IndexedDB). Event dates drive history; edits keep timestamps.</div>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-ghost py-2.5 text-sm" onClick={doExport}>⬇ Export backup</button>
          <button className="btn-ghost py-2.5 text-sm" onClick={() => fileRef.current?.click()}>⬆ Import backup</button>
        </div>
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={onImportFile} />
        <button className="btn-ghost w-full mt-2 py-2.5 text-sm text-bad" onClick={async () => { if (confirm('Erase ALL data and start over? Export a backup first — this cannot be undone.')) { await resetAll(); toast('All data cleared'); } }}>Reset all data</button>
      </Card>

      {/* Setup / limitations */}
      <SectionTitle>Setup notes & limitations</SectionTitle>
      <Card className="mb-6 text-sm text-muted space-y-2">
        <p><b className="text-text">Works now, fully offline:</b> onboarding, dashboard, 15-week plan, all logging, history, analytics, rule-based coach, local social feed, export/import, PWA install.</p>
        <p><b className="text-text">Needs external setup:</b></p>
        <ul className="list-disc pl-4 space-y-1">
          <li><b>Multi-user social</b> (other athletes, follows, cross-device): a backend like Supabase — auth, Postgres, row-level security, storage.</li>
          <li><b>AI coach via LLM</b> (free-form answers): a server-side API key (never in frontend). The built-in coach is rule-based and needs no key.</li>
          <li><b>Device sync</b> (steps, sleep, HR, routes): Apple Health / Health Connect / Garmin / Fitbit / Strava APIs + your authorization.</li>
          <li><b>Push reminders</b>: a service worker is included; scheduled push needs a push service & permission.</li>
        </ul>
      </Card>

      <Sheet open={editProfile} onClose={() => setEditProfile(false)} title="Edit profile"><EditProfileForm onDone={() => setEditProfile(false)} /></Sheet>
      <Sheet open={editTargets} onClose={() => setEditTargets(false)} title="Edit nutrition targets"><EditTargetsForm onDone={() => setEditTargets(false)} /></Sheet>
    </div>
  );
}

function SettingsSection() {
  const { settings, saveSettings } = useApp();
  if (!settings) return null;
  const toggleReminder = async (key: string) => {
    const reminders: Reminder[] = settings.reminders.map((r) => r.key === key ? { ...r, enabled: !r.enabled } : r);
    await saveSettings({ ...settings, reminders });
  };
  const setTime = async (key: string, time: string) => {
    const reminders = settings.reminders.map((r) => r.key === key ? { ...r, time } : r);
    await saveSettings({ ...settings, reminders });
  };
  return (
    <>
      <SectionTitle>Reminders</SectionTitle>
      <Card className="mb-3">
        {settings.reminders.map((r) => (
          <div key={r.key} className="flex items-center justify-between py-2 border-b border-line last:border-0">
            <span className="text-sm">{r.label}</span>
            <div className="flex items-center gap-2">
              {r.enabled && <input type="time" value={r.time ?? '08:00'} onChange={(e) => setTime(r.key, e.target.value)} className="bg-surface-2 border border-line rounded-lg px-2 py-1 text-xs" />}
              <button onClick={() => toggleReminder(r.key)} className={`w-11 h-6 rounded-full transition relative ${r.enabled ? 'bg-accent' : 'bg-surface-2 border border-line'}`}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${r.enabled ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </div>
          </div>
        ))}
        <InfoNote>Reminders are saved as preferences. Delivering them as background notifications needs notification permission and a push service — enable per-reminder here and connect that service when available.</InfoNote>
      </Card>
      <SectionTitle>Water serving size</SectionTitle>
      <Card className="mb-3">
        <Segmented value={String(settings.waterServingMl)} onChange={(v) => saveSettings({ ...settings, waterServingMl: Number(v) })} options={[{ value: '200', label: '200ml' }, { value: '250', label: '250ml' }, { value: '330', label: '330ml' }, { value: '500', label: '500ml' }]} />
      </Card>
    </>
  );
}

function EditProfileForm({ onDone }: { onDone: () => void }) {
  const { profile, saveProfile } = useApp();
  const toast = useToast();
  const [p, setP] = useState<P>(profile!);
  const set = (patch: Partial<P>) => setP((prev) => ({ ...prev, ...patch }));
  const toggleGoal = (g: GoalKey) => {
    const has = p.goals.includes(g);
    const goals = has ? p.goals.filter((x) => x !== g) : [...p.goals, g];
    set({ goals, primaryGoal: goals.includes(p.primaryGoal) ? p.primaryGoal : goals[0] ?? 'hyrox' });
  };
  const submit = async () => { await saveProfile(p); toast('Profile saved'); onDone(); };

  return (
    <div>
      <Field label="Display name"><input className="field" value={p.displayName} onChange={(e) => set({ displayName: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Age"><input className="field" inputMode="numeric" value={p.age ?? ''} onChange={(e) => set({ age: num(e.target.value) })} /></Field>
        <Field label="DOB" optional><input type="date" className="field" value={p.dob ?? ''} onChange={(e) => set({ dob: e.target.value, age: ageFromDob(e.target.value) })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Height (cm)"><input className="field" inputMode="decimal" value={p.heightCm ?? ''} onChange={(e) => set({ heightCm: num(e.target.value) })} /></Field>
        <Field label="Weight (kg)"><input className="field" inputMode="decimal" value={p.weightKg ?? ''} onChange={(e) => set({ weightKg: num(e.target.value) })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Goal weight (kg)" optional><input className="field" inputMode="decimal" value={p.goalWeightKg ?? ''} onChange={(e) => set({ goalWeightKg: num(e.target.value) })} /></Field>
        <Field label="Diet"><input className="field" value={p.diet} onChange={(e) => set({ diet: e.target.value })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Race date"><input type="date" className="field" value={p.raceDate} onChange={(e) => set({ raceDate: e.target.value })} /></Field>
        <Field label="Training start"><input type="date" className="field" value={p.trainingStartDate} onChange={(e) => set({ trainingStartDate: e.target.value })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Step goal"><input className="field" inputMode="numeric" value={p.stepGoal} onChange={(e) => set({ stepGoal: num(e.target.value) ?? 8000 })} /></Field>
        <Field label="Water target (ml)"><input className="field" inputMode="numeric" value={p.waterTargetMl} onChange={(e) => set({ waterTargetMl: num(e.target.value) ?? 3000 })} /></Field>
      </div>
      <Field label="Goals">
        <div className="flex flex-wrap gap-1.5">{(Object.keys(GOAL_LABELS) as GoalKey[]).map((g) => <Chip key={g} active={p.goals.includes(g)} onClick={() => toggleGoal(g)}>{GOAL_LABELS[g]}</Chip>)}</div>
      </Field>
      {p.goals.length > 0 && (
        <Field label="Primary goal"><div className="flex flex-wrap gap-1.5">{p.goals.map((g) => <Chip key={g} active={p.primaryGoal === g} onClick={() => set({ primaryGoal: g })}>{p.primaryGoal === g ? '★ ' : ''}{GOAL_LABELS[g]}</Chip>)}</div></Field>
      )}
      <InfoNote>Changing race or start date? Use "Regenerate plan" afterward to rebuild the calendar. Logged workouts stay intact.</InfoNote>
      <div className="h-3" />
      <button className="btn-primary w-full" onClick={submit}>Save profile</button>
    </div>
  );
}

function EditTargetsForm({ onDone }: { onDone: () => void }) {
  const { profile, saveProfile } = useApp();
  const toast = useToast();
  const [p, setP] = useState<P>(profile!);
  const est = estimateNutrition(profile!);
  const set = (patch: Partial<P>) => setP((prev) => ({ ...prev, ...patch }));
  const submit = async () => { await saveProfile(p); toast('Targets saved'); onDone(); };

  return (
    <div>
      {est.canEstimate && (
        <Card className="mb-3">
          <div className="text-sm font-semibold mb-1">Suggested (estimate)</div>
          <div className="text-xs text-muted mb-2">{est.calories} kcal · {est.protein}p · {est.carbs}c · {est.fat}f</div>
          <button className="btn-ghost w-full py-2 text-sm" onClick={() => set({ calorieTarget: est.calories, proteinTarget: est.protein, carbTarget: est.carbs, fatTarget: est.fat })}>Use estimate</button>
          <div className="mt-2 text-[11px] text-muted">{est.rationale.join(' ')}</div>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Calories (kcal)"><input className="field" inputMode="numeric" value={p.calorieTarget ?? ''} onChange={(e) => set({ calorieTarget: num(e.target.value) })} /></Field>
        <Field label="Protein (g)"><input className="field" inputMode="numeric" value={p.proteinTarget ?? ''} onChange={(e) => set({ proteinTarget: num(e.target.value) })} /></Field>
        <Field label="Carbs (g)"><input className="field" inputMode="numeric" value={p.carbTarget ?? ''} onChange={(e) => set({ carbTarget: num(e.target.value) })} /></Field>
        <Field label="Fat (g)"><input className="field" inputMode="numeric" value={p.fatTarget ?? ''} onChange={(e) => set({ fatTarget: num(e.target.value) })} /></Field>
      </div>
      <InfoNote>These are your editable targets. The app won't push aggressive calorie restriction during heavy training.</InfoNote>
      <div className="h-3" />
      <button className="btn-primary w-full" onClick={submit}>Save targets</button>
    </div>
  );
}
