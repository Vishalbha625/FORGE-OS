import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Globe, ImageOff, Lock, Users } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { getCachedAvatarUrl, getCachedPhotoUrl, type CommunityPost, type CommunityProfile, type Visibility } from '../../lib/communityService';
import { fmtDuration, fmtPace } from '../../lib/calc';

export const ACTIVITY_TYPES = ['Run', 'Strength', 'HYROX', 'Recovery', 'Other'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const VISIBILITY: { value: Visibility; label: string; hint: string }[] = [
  { value: 'private', label: 'Private', hint: 'Only you' },
  { value: 'followers', label: 'Followers', hint: 'Your followers' },
  { value: 'public', label: 'Public', hint: 'Anyone in the community' },
];

export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

export function initials(name: string | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Display name of the signed-in user: their chosen name, else the part of the email before @. */
export function myDisplayName(user: User | null): string {
  const meta = user?.user_metadata as { display_name?: unknown; full_name?: unknown } | undefined;
  const name = typeof meta?.display_name === 'string' ? meta.display_name : typeof meta?.full_name === 'string' ? meta.full_name : '';
  return name || user?.email?.split('@')[0] || 'You';
}

const AVATAR_SIZE = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-20 w-20 text-2xl' } as const;

/** Profile photo when there is one, initials otherwise (and while it loads). */
export function Avatar({ name, path, size = 'md' }: { name: string | undefined; path?: string; size?: keyof typeof AVATAR_SIZE }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (path) getCachedAvatarUrl(path).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [path]);
  const dims = AVATAR_SIZE[size];
  if (url) return <img src={url} alt="" className={`shrink-0 rounded-full border border-border object-cover ${dims}`} onError={() => setUrl(null)} />;
  return (
    <span className={`grid shrink-0 place-items-center rounded-full border border-border bg-secondary font-medium text-foreground/80 ${dims}`} aria-hidden>
      {initials(name)}
    </span>
  );
}

/** One athlete in a list: avatar, name and the first line of their bio. */
export function ProfileRow({ profile, right }: { profile: CommunityProfile; right?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Link to={`/community/profile/${profile.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={profile.display_name} path={profile.avatar_path} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{profile.display_name}</span>
          {profile.bio && <span className="block truncate text-xs text-muted">{profile.bio}</span>}
        </span>
      </Link>
      {right}
    </li>
  );
}

const VIS_ICON = { private: Lock, followers: Users, public: Globe } as const;
export function VisibilityIcon({ visibility }: { visibility: Visibility }) {
  const Icon = VIS_ICON[visibility];
  const label = VISIBILITY.find((v) => v.value === visibility)?.hint ?? visibility;
  return (
    <span title={label} className="inline-flex text-muted">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only">Visible to: {label}</span>
    </span>
  );
}

/** Only the stats the author shared; missing ones are skipped, never shown as 0 (R2). */
export function postStats(post: Pick<CommunityPost, 'distance_km' | 'duration_sec' | 'pace_sec_per_km' | 'elevation_m'>): string[] {
  const out: string[] = [];
  if (post.distance_km !== undefined) out.push(`${Number(post.distance_km.toFixed(2))} km`);
  if (post.duration_sec !== undefined) out.push(fmtDuration(post.duration_sec));
  if (post.pace_sec_per_km !== undefined) out.push(`${fmtPace(post.pace_sec_per_km)} /km`);
  if (post.elevation_m !== undefined) out.push(`↑ ${post.elevation_m} m`);
  return out;
}

/** Signed photo URL with a skeleton while it loads. */
export function PostPhoto({ path, variant }: { path: string; variant: 'thumb' | 'full' }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setUrl(undefined);
    getCachedPhotoUrl(path, variant).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [path, variant]);
  if (url === undefined) return <div className="aspect-[4/3] w-full rounded-lg bg-secondary motion-safe:animate-pulse" role="status" aria-label="Loading photo" />;
  if (url === null) {
    return (
      <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-lg border border-border text-xs text-muted">
        <ImageOff className="h-4 w-4" aria-hidden /> Photo unavailable right now
      </div>
    );
  }
  return <img src={url} alt="" loading="lazy" decoding="async" onError={() => setUrl(null)} className="aspect-[4/3] w-full rounded-lg border border-border object-cover" />;
}
