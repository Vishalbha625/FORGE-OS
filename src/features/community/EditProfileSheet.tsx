import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Camera, Plus, X } from 'lucide-react';
import { Chip, Field, Sheet } from '../../components/ui';
import { useToast } from '../../store/toast';
import { updateProfile, uploadAvatar, type CommunityProfile } from '../../lib/communityService';
import { Avatar } from './shared';

export const GOAL_PRESETS = ['HYROX', 'Running', 'Strength', 'Weight loss', 'General fitness', 'Marathon', 'Ultra', 'CrossFit'];
const MAX_GOALS = 10;

interface Props {
  profile: CommunityProfile | null;
  open: boolean;
  onClose: () => void;
  onSaved: (profile: CommunityProfile) => void;
}

export function EditProfileSheet({ profile, open, onClose, onSaved }: Props) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [goals, setGoals] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [avatarPath, setAvatarPath] = useState<string | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fill the form when the sheet opens, and only then: a photo upload also
  // updates `profile`, and must not wipe what the athlete has typed.
  const profileRef = useRef(profile);
  profileRef.current = profile;
  useEffect(() => {
    const p = profileRef.current;
    if (!open || !p) return;
    setName(p.display_name);
    setBio(p.bio ?? '');
    setGoals(p.goals);
    setAvatarPath(p.avatar_path);
    setCustom('');
    setError(null);
  }, [open]);

  if (!profile) return null;

  const toggleGoal = (g: string) =>
    setGoals((list) => (list.includes(g) ? list.filter((x) => x !== g) : list.length < MAX_GOALS ? [...list, g] : list));
  const addCustom = () => {
    const g = custom.trim().slice(0, 40);
    if (g && !goals.some((x) => x.toLowerCase() === g.toLowerCase()) && goals.length < MAX_GOALS) setGoals([...goals, g]);
    setCustom('');
  };

  const changePhoto = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    const res = await uploadAvatar(profile.id, file);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
    if (res.error || !res.data) {
      setError(res.error ?? 'Could not upload the photo.');
      return;
    }
    setAvatarPath(undefined); // remount the avatar so it fetches the new photo
    setTimeout(() => setAvatarPath(res.data ?? undefined), 0);
    onSaved({ ...profile, avatar_path: res.data });
    toast('Photo updated');
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await updateProfile(profile.id, { display_name: name, bio, goals });
    setBusy(false);
    if (res.error || !res.data) {
      setError(res.error ?? 'Could not save your profile.');
      return;
    }
    onSaved({ ...res.data, avatar_path: avatarPath ?? res.data.avatar_path });
    toast('Profile saved');
    onClose();
  };

  const presetsAndMine = [...GOAL_PRESETS, ...goals.filter((g) => !GOAL_PRESETS.includes(g))];

  return (
    <Sheet open={open} onClose={onClose} title="Edit profile">
      <form onSubmit={save} noValidate>
        <div className="mb-5 flex items-center gap-4">
          <Avatar name={name || profile.display_name} path={avatarPath} size="lg" />
          <div>
            <input ref={fileRef} type="file" accept="image/*" className="sr-only" aria-label="Choose a profile photo" onChange={(e) => changePhoto(e.target.files?.[0])} />
            <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Camera className="h-4 w-4" aria-hidden /> {uploading ? 'Uploading…' : 'Change photo'}
            </button>
            <p className="mt-1 text-xs text-muted">Resized to a small square before it uploads.</p>
          </div>
        </div>

        <Field label="Display name">
          <input className="field" maxLength={60} required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <Field label="Bio" optional hint={`${bio.length}/300`}>
          <textarea className="field min-h-[88px]" maxLength={300} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Training for HYROX Men Open, Jan 2027" />
        </Field>

        <div className="mb-5">
          <span className="label">Goals <span className="ml-1 font-normal text-muted">(tap to add or remove)</span></span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Goals">
            {presetsAndMine.map((g) => <Chip key={g} active={goals.includes(g)} onClick={() => toggleGoal(g)}>{g}</Chip>)}
          </div>
          <div className="mt-2 flex gap-2">
            <input className="field" maxLength={40} value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} placeholder="Add your own goal" aria-label="Add your own goal" />
            <button type="button" className="btn-ghost shrink-0" onClick={addCustom} disabled={!custom.trim() || goals.length >= MAX_GOALS} aria-label="Add goal">
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {goals.length > 0 && (
            <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted">
              Selected: {goals.map((g) => (
                <button key={g} type="button" className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-foreground/80" onClick={() => toggleGoal(g)} aria-label={`Remove ${g}`}>
                  {g} <X className="h-3 w-3" aria-hidden />
                </button>
              ))}
            </p>
          )}
        </div>

        {error && <p role="alert" className="mb-4 rounded-lg border border-bad/40 px-3 py-2.5 text-sm text-bad">{error}</p>}
        <button type="submit" className="btn-solid w-full" disabled={busy || uploading || !name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </Sheet>
  );
}
