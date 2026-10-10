import { useRef, useState } from 'react';
import { User, RefreshCw, Download, Upload } from 'lucide-react';
import { useConfirm } from '../../store/confirm';
import { useApp } from '../../store/AppContext';
import { useToast } from '../../store/toast';
import { AppHeader } from '../../components/Layout';
import { Card, SectionTitle, Field, Sheet, Chip, InfoNote, Segmented, Highlight } from '../../components/ui';
import { estimateNutrition, cmToFtIn, ageFromDob } from '../../lib/calc';
import { fmtDate } from '../../lib/dates';
import { GOAL_LABELS, DEFAULT_SUPPLEMENTS } from '../../lib/constants';
import type { BackupFile } from '../../db/database';
import { mergeReminders } from '../../lib/reminders';
import { diffKeys } from '../../lib/audit';
import { notify } from '../../components/ReminderRunner';
import { fmtDateTimeIST } from '../../lib/dates';
import type { Profile as P, GoalKey, Reminder, Supplement } from '../../db/types';

const num = (v: string): number | undefined => (v.trim() === '' ? undefined : isNaN(Number(v)) ? undefined : Number(v));

export function Profile() {
  const { profile, settings, saveProfile, regeneratePlan, exportData, importData, resetAll, data } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [editProfile, setEditProfile] = useState(false);
  const [editTargets, setEditTargets] = useState(false);
  const [pendingImport, setPendingImport] = useState<BackupFile | null>(null);
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
    if (fileRef.current) fileRef.current.value = '';
    if (!f) return;
    try {
      const file = JSON.parse(await f.text()) as BackupFile;
      if (file?.app !== 'forge-os' || !file.data) throw new Error('not a backup');
      setPendingImport(file);
    } catch {
      toast('That file is not a Forge OS backup');
    }
  };

  const runImport = async (mode: 'merge' | 'replace') => {
    if (!pendingImport) return;
    if (mode === 'replace') {
      const ok = await confirm({
        title: 'Replace your data with this backup?',
        description: 'Every record type in the backup replaces what is on this device. Anything logged here and missing from the backup will be lost.',
        confirmLabel: 'Replace data',
        tone: 'danger',
      });
      if (!ok) return;
    }
    try {
      const res = await importData(pendingImport, mode);
      toast(`Imported: ${res.added} added, ${res.updated} updated, ${res.skipped} kept as they were`);
    } catch {
      toast('Import failed. Nothing was changed.');
    }
    setPendingImport(null);
  };

  const regenerate = async () => {
    const ok = await confirm({
      title: 'Rebuild the training plan?',
      description: `Generated sessions from ${fmtDate(profile.trainingStartDate)} to ${fmtDate(profile.raceDate)} are rebuilt. Days you edited by hand keep your version, and logged workouts are never touched.`,
      confirmLabel: 'Rebuild plan',
    });
    if (!ok) return;
    await regeneratePlan(profile.trainingStartDate, profile.raceDate);
    toast('Plan rebuilt');
  };

  const reset = async () => {
    const ok = await confirm({
      title: 'Erase all data on this device?',
      description: 'Your profile, plan, every log, posts, photos and edit history are deleted, and you start onboarding again. Download a backup first if you might want them back.',
      confirmLabel: 'Erase everything',
      tone: 'danger',
    });
    if (!ok) return;
    await resetAll();
    toast('All data cleared');
  };

  const totalRecords = Object.values(data).reduce((a, arr) => a + (arr as unknown[]).length, 0);
  const importCount = pendingImport ? Object.values(pendingImport.data).reduce((a, arr) => a + (Array.isArray(arr) ? arr.length : 0), 0) : 0;

  return (
    <div>
      <AppHeader title="Profile" subtitle={<>Your details, targets and <Highlight>settings</Highlight>.</>} />

      <Card>
        <div className="flex items-center gap-3">
          <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-secondary">
            {profile.photo ? <img src={profile.photo} className="h-full w-full object-cover" alt="" /> : <User className="h-5 w-5 text-muted" aria-hidden />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-montserrat text-lg font-semibold">{profile.displayName}</div>
            <div className="text-xs text-muted">{profile.age ?? '–'} yrs · {cmToFtIn(profile.heightCm)} · {profile.weightKg ?? '–'} kg</div>
            <div className="text-xs text-muted">{profile.country} · {profile.timezone}</div>
          </div>
          <button className="btn-ghost" onClick={() => setEditProfile(true)}>Edit</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {profile.goals.map((g) => (
            <span key={g} className={`pill ${g === profile.primaryGoal ? 'border-accent/40 text-accent' : 'border-border text-muted'}`}>
              {GOAL_LABELS[g]}{g === profile.primaryGoal ? ' (primary)' : ''}
            </span>
          ))}
        </div>
      </Card>

      <SectionTitle>Race and plan</SectionTitle>
      <Card>
        <dl className="space-y-1.5 text-sm">
          {([
            ['Race', profile.raceDivision],
            ['Race date', fmtDate(profile.raceDate)],
            ['Training start', fmtDate(profile.trainingStartDate)],
            ['Planned sessions', String(data.plannedWorkouts.length)],
          ] as const).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="font-medium">{v}</dd></div>
          ))}
        </dl>
        <button className="btn-ghost mt-4 w-full" onClick={regenerate}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Rebuild plan
        </button>
      </Card>

      <SectionTitle action={<button className="link" onClick={() => setEditTargets(true)}>Edit</button>}>Nutrition targets</SectionTitle>
      <Card>
        {profile.calorieTarget ? (
          <dl className="grid grid-cols-4 gap-1 text-center">
            {([
              [profile.calorieTarget, 'kcal'],
              [profile.proteinTarget, 'protein g'],
              [profile.carbTarget, 'carbs g'],
              [profile.fatTarget, 'fat g'],
            ] as const).map(([v, l]) => (
              <div key={l}><dd className="font-montserrat font-semibold tabular-nums">{v ?? '–'}</dd><dt className="text-[11px] text-muted">{l}</dt></div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted">No targets set. {est.canEstimate ? `Estimate: ${est.calories} kcal, ${est.protein} g protein.` : `Add ${est.missing.join(', ')} to get an estimate.`}</p>
        )}
      </Card>

      <SectionTitle lead="Tap to mark which ones you currently take.">Supplements</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        {DEFAULT_SUPPLEMENTS.map((s) => {
          const active = profile.supplements.some((x) => x.name === s.name && x.active);
          return (
            <Chip
              key={s.name}
              active={active}
              onClick={async () => {
                const exists = profile.supplements.find((x) => x.name === s.name);
                const supps: Supplement[] = exists
                  ? profile.supplements.map((x) => (x.name === s.name ? { ...x, active: !x.active } : x))
                  : [...profile.supplements, { ...s }];
                await saveProfile({ ...profile, supplements: supps });
              }}
            >
              {s.name}
            </Chip>
          );
        })}
      </div>

      {settings && <SettingsSection />}

      <SectionTitle lead="None are connected. They need platform APIs and your permission.">Device integrations</SectionTitle>
      <Card className="divide-y divide-border p-0">
        {settings?.integrations.map((i) => (
          <div key={i.key} className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <div className="text-sm font-medium">{i.label}</div>
              <div className="text-xs text-muted">{i.provides}</div>
            </div>
            <span className="pill border-border text-muted">Not available</span>
          </div>
        ))}
      </Card>
      <div className="mt-3">
        <InfoNote>Apple Health and Health Connect need a native app; Garmin, Fitbit and Strava need developer API access and your sign-in. Until then, data is typed in and labelled as manual, never made up.</InfoNote>
      </div>

      <EditHistory />

      <SectionTitle lead={`${totalRecords} records stored on this device.`}>Data and backup</SectionTitle>
      <Card>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-ghost" onClick={doExport}><Download className="h-4 w-4" aria-hidden /> Export</button>
          <button className="btn-ghost" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" aria-hidden /> Import</button>
        </div>
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={onImportFile} aria-label="Choose a backup file" />
        <button className="mt-3 w-full text-sm text-bad hover:underline" onClick={reset}>Erase all data</button>
      </Card>

      <SectionTitle>Setup notes</SectionTitle>
      <Card className="space-y-2 text-sm text-muted">
        <p><b className="font-medium text-foreground">Works now, offline:</b> onboarding, the 15-week plan, all logging with edit history, analytics, the rule-based coach, your local feed, reminders while the app is open, backup and install to home screen.</p>
        <p><b className="font-medium text-foreground">With your own setup:</b> the AI coach. Run <code>npm start</code> with an <code>ANTHROPIC_API_KEY</code>, then turn on AI coach above. The key stays on the server.</p>
        <p><b className="font-medium text-foreground">Needs external services:</b></p>
        <ul className="list-disc space-y-1 pl-4">
          <li>Shared community with other athletes: a Supabase project (schema and privacy rules in <code>supabase/schema.sql</code>, not connected yet).</li>
          <li>Device sync for steps, sleep, heart rate and routes: the platform APIs above.</li>
          <li>Reminders while the app is closed: a push service.</li>
        </ul>
      </Card>

      <Sheet open={!!pendingImport} onClose={() => setPendingImport(null)} title="Import backup">
        <p className="text-sm text-muted">
          This backup holds {importCount} records{pendingImport?.exportedAt ? `, exported ${fmtDateTimeIST(pendingImport.exportedAt)}` : ''}.
        </p>
        <div className="mt-4 space-y-2">
          <button className="btn-solid w-full" onClick={() => runImport('merge')}>Merge with my data</button>
          <p className="text-xs text-muted">Recommended. Adds new records and takes newer versions; nothing is duplicated and newer local edits are kept.</p>
          <button className="btn-ghost mt-2 w-full !text-bad" onClick={() => runImport('replace')}>Replace my data</button>
        </div>
      </Sheet>
      <Sheet open={editProfile} onClose={() => setEditProfile(false)} title="Edit profile"><EditProfileForm onDone={() => setEditProfile(false)} /></Sheet>
      <Sheet open={editTargets} onClose={() => setEditTargets(false)} title="Edit nutrition targets"><EditTargetsForm onDone={() => setEditTargets(false)} /></Sheet>
    </div>
  );
}

function EditHistory() {
  const { audit } = useApp();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const shown = open ? audit.slice(0, 100) : audit.slice(0, 5);
  return (
    <>
      <SectionTitle action={audit.length > 5 ? <button className="link" onClick={() => setOpen((o) => !o)}>{open ? 'Show less' : `Show all (${audit.length})`}</button> : undefined}>Edit history</SectionTitle>
      <Card className="mb-3">
        {audit.length === 0 ? (
          <div className="text-sm text-muted">No edits or deletions yet. When you change or delete a logged record, the before/after is kept here.</div>
        ) : (
          <div className="divide-y divide-line">
            {shown.map((a) => {
              const changed = a.action === 'update' ? diffKeys(a.before, a.after) : [];
              return (
                <button key={a.id} className="w-full text-left py-2 first:pt-0 last:pb-0" onClick={() => setExpanded((e) => (e === a.id ? null : a.id))}>
                  <div className="flex justify-between gap-2 text-sm">
                    <span className={a.action === 'delete' ? 'text-bad' : ''}>{a.summary}</span>
                    <span className="text-[11px] text-muted shrink-0">{fmtDateTimeIST(a.at)}</span>
                  </div>
                  {changed.length > 0 && <div className="text-[11px] text-muted">changed: {changed.join(', ')}</div>}
                  {expanded === a.id && (
                    <pre className="text-[10px] text-muted bg-surface-2 rounded-lg p-2 mt-1 overflow-x-auto whitespace-pre-wrap break-all">
                      {a.action === 'update'
                        ? changed.map((k) => `${k}: ${JSON.stringify((a.before as Record<string, unknown>)?.[k])} → ${JSON.stringify((a.after as Record<string, unknown>)?.[k])}`).join('\n')
                        : JSON.stringify(a.before, null, 1)}
                    </pre>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} role="switch" aria-checked={on} aria-label={label} className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${on ? 'border-transparent bg-foreground' : 'border-border bg-secondary'}`}>
      <span className={`absolute top-[3px] h-4 w-4 rounded-full transition-all motion-reduce:transition-none ${on ? 'left-[22px] bg-background' : 'left-[3px] bg-foreground/70'}`} />
    </button>
  );
}

function AiCoachSection() {
  const { settings, saveSettings } = useApp();
  const [status, setStatus] = useState<string | null>(null);
  if (!settings) return null;
  const on = !!settings.aiCoachEnabled;
  const check = async () => {
    setStatus('Checking…');
    try {
      const res = await fetch('/api/health');
      const body = await res.json();
      setStatus(body.keyPresent ? `Server running · ${body.model} · credentials found` : `Server running · ${body.model} · no API key in its environment`);
    } catch {
      setStatus('No coach server reachable. Start it with `npm start` (or `npm run server` alongside `npm run dev`).');
    }
  };
  return (
    <>
      <SectionTitle>AI coach</SectionTitle>
      <Card className="mb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Use Claude for coach answers</div>
            <div className="text-xs text-muted">Off: the rule-based coach answers on this device. On: your question and a 4-week summary of your logs (no photos) go to your own Forge OS server, which calls Anthropic's API.</div>
          </div>
          <Toggle on={on} label="AI coach" onClick={() => saveSettings({ ...settings, aiCoachEnabled: !on })} />
        </div>
        <button className="btn-ghost w-full mt-3 py-2 text-sm" onClick={check}>Check coach server</button>
        {status && <div className="text-xs text-muted mt-2">{status}</div>}
      </Card>
    </>
  );
}

function SettingsSection() {
  const { settings, saveSettings } = useApp();
  const toast = useToast();
  const [perm, setPerm] = useState<string>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  if (!settings) return null;
  const reminders = mergeReminders(settings.reminders);
  const writeReminders = (next: Reminder[]) => saveSettings({ ...settings, reminders: next });
  const toggleReminder = async (key: string) => {
    const turningOn = !reminders.find((r) => r.key === key)?.enabled;
    if (turningOn && perm === 'default' && typeof Notification !== 'undefined') {
      setPerm(await Notification.requestPermission());
    }
    await writeReminders(reminders.map((r) => (r.key === key ? { ...r, enabled: !r.enabled } : r)));
  };
  const setTime = (key: string, time: string) => writeReminders(reminders.map((r) => (r.key === key ? { ...r, time } : r)));
  const qh = settings.quietHours ?? { start: '', end: '' };
  const setQuiet = (patch: Partial<{ start: string; end: string }>) => {
    const next = { ...qh, ...patch };
    saveSettings({ ...settings, quietHours: next.start && next.end ? next : undefined });
  };
  const test = async () => {
    let p = perm;
    if (p === 'default' && typeof Notification !== 'undefined') {
      p = await Notification.requestPermission();
      setPerm(p);
    }
    const via = await notify('Forge OS', 'Notifications are working.', toast);
    if (via === 'toast') toast('Shown in-app, system notifications are blocked or unsupported in this browser.');
  };

  return (
    <>
      <SectionTitle>Reminders</SectionTitle>
      <Card className="mb-3">
        {reminders.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-2 py-2 border-b border-line last:border-0">
            <span className="text-sm">{r.label}</span>
            <div className="flex items-center gap-2">
              {r.enabled && <input type="time" value={r.time ?? '08:00'} onChange={(e) => setTime(r.key, e.target.value)} className="bg-surface-2 border border-line rounded-lg px-2 py-1 text-xs" aria-label={`${r.label} time`} />}
              <Toggle on={r.enabled} label={r.label} onClick={() => toggleReminder(r.key)} />
            </div>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Quiet from" optional><input type="time" className="field py-2" value={qh.start} onChange={(e) => setQuiet({ start: e.target.value })} /></Field>
          <Field label="Quiet until" optional><input type="time" className="field py-2" value={qh.end} onChange={(e) => setQuiet({ end: e.target.value })} /></Field>
        </div>
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-muted">Notification permission: <b className="text-text">{perm}</b></span>
          <button className="link" onClick={test}>Send test</button>
        </div>
        <InfoNote>Reminders fire while Forge OS is open (in a tab or the installed app). Browsers don't run app code when it's fully closed, so true background delivery would need a push service. "Workout" and "Missing log" reminders only fire on days with an unlogged planned session.</InfoNote>
      </Card>
      <AiCoachSection />
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
        <Field label="Date of birth" optional><input type="date" className="field" value={p.dob ?? ''} onChange={(e) => set({ dob: e.target.value, age: ageFromDob(e.target.value) })} /></Field>
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
        <Field label="Primary goal"><div className="flex flex-wrap gap-1.5">{p.goals.map((g) => <Chip key={g} active={p.primaryGoal === g} onClick={() => set({ primaryGoal: g })}>{GOAL_LABELS[g]}</Chip>)}</div></Field>
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
