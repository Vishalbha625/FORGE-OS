import { useMemo, useState } from 'react';
import { Megaphone, Lock, Users, Globe, MoreHorizontal, ThumbsUp, MessageCircle, MapPin, Trophy, User, Search, X } from 'lucide-react';
import { useApp, newRecord, uid } from '../../store/AppContext';
import { useToast } from '../../store/toast';
import { useConfirm } from '../../store/confirm';
import { AppHeader } from '../../components/Layout';
import { Card, SectionTitle, Sheet, Segmented, Field, EmptyState, InfoNote, Chip, Highlight } from '../../components/ui';
import { downscaleImage } from '../logging/forms';
import { fmtDate, todayISO } from '../../lib/dates';
import { fmtPace, fmtDuration, round1 } from '../../lib/calc';
import { generateWeeklyReport } from '../../lib/coach';
import { GOAL_LABELS } from '../../lib/constants';
import type { SocialPost, Visibility, Comment, RunRecord } from '../../db/types';

const VIS: Record<Visibility, { label: string; icon: typeof Lock }> = {
  private: { label: 'Private', icon: Lock },
  followers: { label: 'Followers', icon: Users },
  public: { label: 'Public', icon: Globe },
};

function VisLabel({ v }: { v: Visibility }) {
  const { label, icon: Icon } = VIS[v];
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3 w-3" aria-hidden /> {label}
    </span>
  );
}

function Avatar({ photo, size = 'h-9 w-9' }: { photo?: string; size?: string }) {
  return (
    <div className={`${size} grid shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-secondary`}>
      {photo ? <img src={photo} className="h-full w-full object-cover" alt="" /> : <User className="h-4 w-4 text-muted" aria-hidden />}
    </div>
  );
}

export function Community() {
  const { data, profile, save, remove, snapshot } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [composer, setComposer] = useState(false);
  const [editing, setEditing] = useState<SocialPost | null>(null);
  const [search, setSearch] = useState('');

  const posts = useMemo(
    () =>
      [...data.social]
        .filter((p) => (search ? `${p.title} ${p.caption ?? ''} ${p.activityType}`.toLowerCase().includes(search.toLowerCase()) : true))
        .sort((a, b) => b.eventDate.localeCompare(a.eventDate) || b.createdAt.localeCompare(a.createdAt)),
    [data.social, search],
  );

  if (!profile) return null;

  const kudos = async (p: SocialPost) => {
    await save('social', { ...p, kudos: p.kudosedByMe ? p.kudos - 1 : p.kudos + 1, kudosedByMe: !p.kudosedByMe });
  };
  const comment = async (p: SocialPost, text: string) => {
    const c: Comment = { id: uid(), author: profile.displayName, text, createdAt: new Date().toISOString() };
    await save('social', { ...p, comments: [...p.comments, c] });
  };
  const changeVis = async (p: SocialPost, v: Visibility) => {
    await save('social', { ...p, visibility: v });
    toast(`Visibility set to ${VIS[v].label.toLowerCase()}`);
  };
  const deletePost = async (p: SocialPost) => {
    const ok = await confirm({
      title: 'Delete this post?',
      description: `"${p.title}" and its ${p.comments.length} comment${p.comments.length === 1 ? '' : 's'} will be removed. Your logged workouts are not affected.`,
      confirmLabel: 'Delete post',
      tone: 'danger',
    });
    if (ok) {
      await remove('social', p.id);
      toast('Post deleted');
    }
  };

  const makeRecap = async () => {
    const r = generateWeeklyReport(snapshot);
    const post = newRecord<Omit<SocialPost, 'id' | 'createdAt' | 'updatedAt'>>({
      eventDate: todayISO(), source: 'manual', author: profile.displayName,
      title: `Weekly recap, ${fmtDate(r.weekStart, { year: undefined })} to ${fmtDate(r.weekEnd, { year: undefined })}`,
      activityType: 'Weekly summary',
      caption: `${r.running.actualKm} km run · ${r.planned.completed}/${r.planned.total} sessions · ${r.strengthSessions} strength · sleep ${r.avgSleepHours ?? '–'} h avg. Next: ${r.priorities[0]}`,
      distanceKm: r.running.actualKm, visibility: 'private', kudos: 0, kudosedByMe: false, comments: [], pr: false,
    }) as SocialPost;
    await save('social', post);
    toast('Weekly recap added as a private post');
  };

  return (
    <div>
      <AppHeader
        title="Community"
        subtitle={<>Share runs, sessions and <Highlight>personal records</Highlight>, on your terms.</>}
        right={
          <>
            <button className="btn-outline" onClick={makeRecap}>Weekly recap</button>
            <button className="btn-soft" onClick={() => setComposer(true)}>New post</button>
          </>
        }
      />

      <Card>
        <div className="flex items-center gap-3">
          <Avatar photo={profile.photo} size="h-12 w-12" />
          <div className="min-w-0 flex-1">
            <div className="font-montserrat font-semibold">{profile.displayName}</div>
            <div className="text-xs text-muted">{profile.raceDivision} · {GOAL_LABELS[profile.primaryGoal] ?? profile.primaryGoal}</div>
          </div>
          <div className="text-center">
            <div className="font-montserrat text-lg font-semibold">{data.social.length}</div>
            <div className="text-[11px] text-muted">posts</div>
          </div>
        </div>
      </Card>

      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <input className="field pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your activities" aria-label="Search activities" />
      </div>

      <div className="mt-3">
        <InfoNote>
          This feed is local-first: posts are stored privately on this device. A shared community with other athletes needs the Supabase backend in <code>supabase/schema.sql</code>. No made-up athletes are shown.
        </InfoNote>
      </div>

      <SectionTitle>Feed</SectionTitle>
      {posts.length === 0 ? (
        <EmptyState
          title={search ? 'No posts match your search' : 'No posts yet'}
          hint={search ? 'Try another word.' : 'Share a run, a workout or a weekly recap.'}
          icon={Megaphone}
          action={!search && <button className="btn-soft" onClick={() => setComposer(true)}>Create a post</button>}
        />
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} me={profile.displayName} photo={profile.photo} onKudos={() => kudos(p)} onComment={(t) => comment(p, t)} onEdit={() => setEditing(p)} onDelete={() => deletePost(p)} onVis={(v) => changeVis(p, v)} />
          ))}
        </div>
      )}

      <Sheet open={composer || !!editing} onClose={() => { setComposer(false); setEditing(null); }} title={editing ? 'Edit post' : 'New post'}>
        <Composer post={editing} onDone={() => { setComposer(false); setEditing(null); }} />
      </Sheet>
    </div>
  );
}

function PostCard({ post, me, photo, onKudos, onComment, onEdit, onDelete, onVis }: {
  post: SocialPost; me: string; photo?: string; onKudos: () => void; onComment: (t: string) => void; onEdit: () => void; onDelete: () => void; onVis: (v: Visibility) => void;
}) {
  const [showComment, setShowComment] = useState(false);
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const send = () => {
    if (!text.trim()) return;
    onComment(text.trim());
    setText('');
  };

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2.5">
        <Avatar photo={photo} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{post.author}</div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted">{fmtDate(post.eventDate)} · <VisLabel v={post.visibility} /></div>
        </div>
        {post.pr && (
          <span className="pill border-accent/40 text-accent">
            <Trophy className="h-3 w-3" aria-hidden /> PR
          </span>
        )}
        <button className="grid h-8 w-8 place-items-center rounded-md text-muted hover:text-foreground" onClick={() => setMenu((m) => !m)} aria-label="Post options" aria-expanded={menu}>
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {menu && (
        <div className="mb-3 rounded-lg border border-border p-3">
          <div className="mb-2 text-xs text-muted">Who can see this</div>
          <Segmented
            label="Visibility"
            value={post.visibility}
            onChange={(v) => onVis(v)}
            options={(['private', 'followers', 'public'] as Visibility[]).map((v) => ({ value: v, label: VIS[v].label }))}
          />
          <div className="mt-3 flex gap-2">
            <button className="btn-ghost flex-1" onClick={onEdit}>Edit</button>
            <button className="btn-ghost flex-1 !text-bad" onClick={onDelete}>Delete</button>
          </div>
        </div>
      )}

      <h3 className="font-montserrat text-base font-semibold leading-snug">{post.title}</h3>
      {post.caption && <p className="mt-1 text-sm text-muted">{post.caption}</p>}
      {post.photo && <img src={post.photo} className="mt-3 max-h-72 w-full rounded-lg object-cover" alt="" />}

      {(post.distanceKm || post.durationSec || post.elevationM) && (
        <dl className="mt-3 flex gap-5 text-sm">
          {post.distanceKm ? <div><dt className="text-[11px] text-muted">Distance</dt><dd className="font-montserrat font-semibold tabular-nums">{post.distanceKm} km</dd></div> : null}
          {post.durationSec ? <div><dt className="text-[11px] text-muted">Time</dt><dd className="font-montserrat font-semibold tabular-nums">{fmtDuration(post.durationSec)}</dd></div> : null}
          {post.paceSecPerKm ? <div><dt className="text-[11px] text-muted">Pace</dt><dd className="font-montserrat font-semibold tabular-nums">{fmtPace(post.paceSecPerKm)} /km</dd></div> : null}
          {post.elevationM ? <div><dt className="text-[11px] text-muted">Elevation</dt><dd className="font-montserrat font-semibold tabular-nums">{post.elevationM} m</dd></div> : null}
        </dl>
      )}
      {post.routeText && (
        <div className="mt-2 flex items-center gap-1 text-xs text-muted">
          <MapPin className="h-3 w-3" aria-hidden /> {post.routeText}
        </div>
      )}

      <div className="mt-3 flex items-center gap-5 border-t border-border pt-3">
        <button className={`inline-flex items-center gap-1.5 text-sm transition-colors ${post.kudosedByMe ? 'text-highlight' : 'text-muted hover:text-foreground'}`} onClick={onKudos} aria-pressed={post.kudosedByMe} aria-label={`Kudos, ${post.kudos}`}>
          <ThumbsUp className="h-4 w-4" aria-hidden /> {post.kudos}
        </button>
        <button className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground" onClick={() => setShowComment((s) => !s)} aria-expanded={showComment} aria-label={`Comments, ${post.comments.length}`}>
          <MessageCircle className="h-4 w-4" aria-hidden /> {post.comments.length}
        </button>
      </div>

      {showComment && (
        <div className="mt-3 space-y-2">
          {post.comments.map((c) => (
            <div key={c.id} className="text-sm"><span className="font-medium">{c.author}</span> <span className="text-muted">{c.text}</span></div>
          ))}
          <div className="flex gap-2">
            <input className="field py-2 text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Comment as ${me}`} aria-label="Write a comment" onKeyDown={(e) => e.key === 'Enter' && send()} />
            <button className="btn-soft" onClick={send}>Post</button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Composer({ post, onDone }: { post: SocialPost | null; onDone: () => void }) {
  const { profile, data, save } = useApp();
  const toast = useToast();
  const [title, setTitle] = useState(post?.title ?? '');
  const [activityType, setActivityType] = useState(post?.activityType ?? 'Run');
  const [caption, setCaption] = useState(post?.caption ?? '');
  const [distance, setDistance] = useState(post?.distanceKm ? String(post.distanceKm) : '');
  const [visibility, setVisibility] = useState<Visibility>(post?.visibility ?? 'private');
  const [pr, setPr] = useState(post?.pr ?? false);
  const [routeText, setRouteText] = useState(post?.routeText ?? '');
  const [photo, setPhoto] = useState<string | undefined>(post?.photo);
  const [fromRun, setFromRun] = useState<RunRecord | null>(null);

  const recentRuns = useMemo(() => [...data.runs].sort((a, b) => b.eventDate.localeCompare(a.eventDate)).slice(0, 5), [data.runs]);

  const prefillRun = (r: RunRecord) => {
    setFromRun(r);
    setTitle(`${r.kind[0].toUpperCase() + r.kind.slice(1)} run`);
    setActivityType('Run');
    setDistance(String(r.distanceKm));
  };

  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    downscaleImage(f, 1200).then(setPhoto).catch(() => toast('Could not read that image'));
  };

  const submit = async () => {
    if (!title.trim()) {
      toast('Add a title');
      return;
    }
    if (!profile) return;
    const km = distance ? round1(Number(distance)) : undefined;
    if (post) {
      await save('social', { ...post, title: title.trim(), activityType, caption: caption || undefined, distanceKm: km, visibility, pr, routeText: routeText || undefined, photo });
    } else {
      // Time and pace only come from a run you picked, never guessed from the distance.
      const run = fromRun && fromRun.distanceKm === km ? fromRun : undefined;
      const np = newRecord<Omit<SocialPost, 'id' | 'createdAt' | 'updatedAt'>>({
        eventDate: run?.eventDate ?? todayISO(), source: 'manual', author: profile.displayName, title: title.trim(), activityType, caption: caption || undefined,
        distanceKm: km, durationSec: run?.durationSec, paceSecPerKm: run?.avgPaceSecPerKm, elevationM: run?.elevationM,
        visibility, kudos: 0, kudosedByMe: false, comments: [], pr, routeText: routeText || undefined, photo,
      }) as SocialPost;
      await save('social', np);
    }
    toast(post ? 'Post updated' : `Posted (${VIS[visibility].label.toLowerCase()})`);
    onDone();
  };

  return (
    <div>
      {!post && recentRuns.length > 0 && (
        <Field label="Share a recent run" optional>
          <div className="flex flex-wrap gap-1.5">
            {recentRuns.map((r) => (
              <Chip key={r.id} active={fromRun?.id === r.id} onClick={() => prefillRun(r)}>
                {r.kind} {r.distanceKm} km · {fmtDate(r.eventDate, { year: undefined })}
              </Chip>
            ))}
          </div>
        </Field>
      )}
      <Field label="Title"><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Morning tempo" /></Field>
      <Field label="Activity type">
        <Segmented label="Activity type" value={activityType} onChange={setActivityType} options={[{ value: 'Run', label: 'Run' }, { value: 'Gym', label: 'Gym' }, { value: 'HYROX', label: 'HYROX' }, { value: 'Walk', label: 'Walk' }]} />
      </Field>
      <Field label="Caption" optional><textarea className="field min-h-[72px]" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="How did it go?" /></Field>
      <Field label="Distance (km)" optional><input className="field" inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value)} /></Field>
      <Field label="Route or location" optional hint="Text only. Map routes need a connected GPS source, and no coordinates are made up.">
        <input className="field" value={routeText} onChange={(e) => setRouteText(e.target.value)} placeholder="Riverside loop" />
      </Field>
      <Field label="Photo" optional>
        <input type="file" accept="image/*" onChange={onPhoto} className="text-sm text-muted" />
        {photo && (
          <div className="relative mt-2">
            <img src={photo} className="max-h-48 w-full rounded-lg object-cover" alt="Post photo preview" />
            <button className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-md bg-black/60 text-white" onClick={() => setPhoto(undefined)} aria-label="Remove photo">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}
      </Field>
      <Field label="Who can see this">
        <Segmented label="Visibility" value={visibility} onChange={(v) => setVisibility(v as Visibility)} options={(['private', 'followers', 'public'] as Visibility[]).map((v) => ({ value: v, label: VIS[v].label }))} />
      </Field>
      <label className="mb-5 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={pr} onChange={(e) => setPr(e.target.checked)} className="h-4 w-4 accent-neutral-500" /> Mark as a personal record
      </label>
      <button className="btn-solid w-full" onClick={submit}>{post ? 'Save changes' : 'Publish post'}</button>
      <p className="mt-2 text-[11px] text-muted">Nothing is shared automatically. New posts start private; health details and exact routes are never added unless you type them.</p>
    </div>
  );
}
