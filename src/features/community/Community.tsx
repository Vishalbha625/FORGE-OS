import { useMemo, useState } from 'react';
import { useApp, newRecord, uid } from '../../store/AppContext';
import { useToast } from '../../store/toast';
import { AppHeader } from '../../components/Layout';
import { Card, SectionTitle, Sheet, Segmented, Field, EmptyState, InfoNote, Chip } from '../../components/ui';
import { fmtDate, todayISO } from '../../lib/dates';
import { fmtPace, fmtDuration, round1 } from '../../lib/calc';
import { generateWeeklyReport } from '../../lib/coach';
import type { SocialPost, Visibility, Comment, RunRecord } from '../../db/types';

const VIS_LABEL: Record<Visibility, string> = { private: '🔒 Private', followers: '👥 Followers', public: '🌍 Public' };

export function Community() {
  const { data, profile, save, remove, snapshot } = useApp();
  const toast = useToast();
  const [composer, setComposer] = useState(false);
  const [editing, setEditing] = useState<SocialPost | null>(null);
  const [search, setSearch] = useState('');

  const posts = useMemo(
    () => [...data.social].filter((p) => (search ? (p.title + p.caption + p.activityType).toLowerCase().includes(search.toLowerCase()) : true)).sort((a, b) => b.eventDate.localeCompare(a.eventDate) || b.createdAt.localeCompare(a.createdAt)),
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
    toast(`Set to ${v}`);
  };

  const makeRecap = async () => {
    const r = generateWeeklyReport(snapshot);
    const post = newRecord<Omit<SocialPost, 'id' | 'createdAt' | 'updatedAt'>>({
      eventDate: todayISO(), source: 'manual', author: profile.displayName,
      title: `Weekly recap · ${fmtDate(r.weekStart)}–${fmtDate(r.weekEnd)}`,
      activityType: 'Weekly summary',
      caption: `${r.running.actualKm} km run · ${r.planned.completed}/${r.planned.total} sessions · ${r.strengthSessions} strength · sleep ${r.avgSleepHours ?? '—'}h avg. Next: ${r.priorities[0]}`,
      distanceKm: r.running.actualKm, visibility: 'followers', kudos: 0, kudosedByMe: false, comments: [], pr: false,
    }) as SocialPost;
    await save('social', post);
    toast('Weekly recap posted');
  };

  return (
    <div>
      <AppHeader title="Community" subtitle="Share your journey" right={<button className="btn-primary px-3 py-1.5 text-sm" onClick={() => setComposer(true)}>+ Post</button>} />

      {/* My athlete profile card */}
      <Card className="mb-3">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center text-2xl">{profile.photo ? <img src={profile.photo} className="w-full h-full rounded-full object-cover" /> : '🏃'}</div>
          <div className="flex-1">
            <div className="font-bold">{profile.displayName}</div>
            <div className="text-xs text-muted">{profile.raceDivision} · goal: {profile.primaryGoal}</div>
          </div>
          <div className="text-center"><div className="font-extrabold">{data.social.length}</div><div className="text-[10px] text-muted">posts</div></div>
        </div>
      </Card>

      <div className="flex gap-2 mb-3">
        <input className="field py-2 text-sm" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search activities…" />
        <button className="btn-ghost px-3 text-sm" onClick={makeRecap}>Recap</button>
      </div>

      <InfoNote>This is your personal, <b>local-first</b> feed — posts are stored privately on this device. A shared multi-user community (other athletes, follows, kudos across devices) requires a backend such as Supabase with auth, per-row privacy rules and file storage; see Profile → Setup notes. No fake athletes are shown.</InfoNote>
      <div className="h-3" />

      <SectionTitle>Feed</SectionTitle>
      {posts.length === 0 ? (
        <EmptyState title="No posts yet" hint="Share a run, workout or weekly recap." icon="📣" action={<button className="btn-primary px-4 py-2 text-sm" onClick={() => setComposer(true)}>Create a post</button>} />
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} me={profile.displayName} onKudos={() => kudos(p)} onComment={(t) => comment(p, t)} onEdit={() => setEditing(p)} onDelete={() => { if (confirm('Delete this post?')) remove('social', p.id); }} onVis={(v) => changeVis(p, v)} />
          ))}
        </div>
      )}

      <Sheet open={composer || !!editing} onClose={() => { setComposer(false); setEditing(null); }} title={editing ? 'Edit post' : 'Create post'}>
        <Composer post={editing} onDone={() => { setComposer(false); setEditing(null); }} />
      </Sheet>
      <div className="h-6" />
    </div>
  );
}

function PostCard({ post, me, onKudos, onComment, onEdit, onDelete, onVis }: {
  post: SocialPost; me: string; onKudos: () => void; onComment: (t: string) => void; onEdit: () => void; onDelete: () => void; onVis: (v: Visibility) => void;
}) {
  const [showComment, setShowComment] = useState(false);
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);

  return (
    <Card>
      <div className="flex items-center gap-2.5 mb-2">
        <div className="w-9 h-9 rounded-full bg-accent/15 flex items-center justify-center text-sm">🏃</div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">{post.author}</div>
          <div className="text-[11px] text-muted">{fmtDate(post.eventDate)} · {VIS_LABEL[post.visibility]}</div>
        </div>
        {post.pr && <span className="pill bg-accent/15 text-accent">🏅 PR</span>}
        <button className="text-muted px-1" onClick={() => setMenu((m) => !m)}>⋯</button>
      </div>

      {menu && (
        <div className="card p-2 mb-2 text-sm">
          <div className="text-xs text-muted px-1 mb-1">Visibility</div>
          <div className="flex gap-1.5 mb-2">
            {(['private', 'followers', 'public'] as Visibility[]).map((v) => <Chip key={v} active={post.visibility === v} onClick={() => onVis(v)}>{VIS_LABEL[v]}</Chip>)}
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost flex-1 py-1.5 text-sm" onClick={onEdit}>Edit</button>
            <button className="btn-ghost flex-1 py-1.5 text-sm text-bad" onClick={onDelete}>Delete</button>
          </div>
        </div>
      )}

      <div className="font-bold">{post.title}</div>
      {post.caption && <p className="text-sm text-muted mt-0.5">{post.caption}</p>}
      {post.photo && <img src={post.photo} className="w-full rounded-xl mt-2 max-h-72 object-cover" />}

      {(post.distanceKm || post.durationSec || post.stationDetail) && (
        <div className="flex gap-4 mt-2 text-sm">
          {post.distanceKm ? <div><div className="font-bold tabular-nums">{post.distanceKm} km</div><div className="text-[10px] text-muted">distance</div></div> : null}
          {post.durationSec ? <div><div className="font-bold tabular-nums">{fmtDuration(post.durationSec)}</div><div className="text-[10px] text-muted">time</div></div> : null}
          {post.paceSecPerKm ? <div><div className="font-bold tabular-nums">{fmtPace(post.paceSecPerKm)}</div><div className="text-[10px] text-muted">/km</div></div> : null}
          {post.elevationM ? <div><div className="font-bold tabular-nums">{post.elevationM} m</div><div className="text-[10px] text-muted">elev</div></div> : null}
        </div>
      )}
      {post.routeText && <div className="text-xs text-muted mt-2">📍 {post.routeText}</div>}

      <div className="flex items-center gap-4 mt-3 pt-2 border-t border-line">
        <button className={`text-sm font-semibold flex items-center gap-1 ${post.kudosedByMe ? 'text-accent' : 'text-muted'}`} onClick={onKudos}>👏 {post.kudos}</button>
        <button className="text-sm font-semibold text-muted flex items-center gap-1" onClick={() => setShowComment((s) => !s)}>💬 {post.comments.length}</button>
      </div>

      {showComment && (
        <div className="mt-2">
          {post.comments.map((c) => (
            <div key={c.id} className="text-sm mb-1"><span className="font-semibold">{c.author}</span> <span className="text-muted">{c.text}</span></div>
          ))}
          <div className="flex gap-2 mt-1">
            <input className="field py-2 text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Comment as ${me}…`} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { onComment(text.trim()); setText(''); } }} />
            <button className="btn-primary px-3 text-sm" onClick={() => { if (text.trim()) { onComment(text.trim()); setText(''); } }}>Post</button>
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
  const [visibility, setVisibility] = useState<Visibility>(post?.visibility ?? 'followers');
  const [pr, setPr] = useState(post?.pr ?? false);
  const [routeText, setRouteText] = useState(post?.routeText ?? '');
  const [photo, setPhoto] = useState<string | undefined>(post?.photo);

  const recentRuns = useMemo(() => [...data.runs].sort((a, b) => b.eventDate.localeCompare(a.eventDate)).slice(0, 5), [data.runs]);

  const prefillRun = (r: RunRecord) => {
    setTitle(`${r.kind[0].toUpperCase() + r.kind.slice(1)} run`);
    setActivityType('Run');
    setDistance(String(r.distanceKm));
  };

  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result as string);
    reader.readAsDataURL(f);
  };

  const submit = async () => {
    if (!title.trim()) { toast('Add a title'); return; }
    if (!profile) return;
    if (post) {
      await save('social', { ...post, title, activityType, caption, distanceKm: distance ? round1(Number(distance)) : undefined, visibility, pr, routeText: routeText || undefined, photo });
    } else {
      const sel = recentRuns.find((r) => distance && r.distanceKm === Number(distance));
      const np = newRecord<Omit<SocialPost, 'id' | 'createdAt' | 'updatedAt'>>({
        eventDate: todayISO(), source: 'manual', author: profile.displayName, title, activityType, caption: caption || undefined,
        distanceKm: distance ? round1(Number(distance)) : undefined,
        durationSec: sel?.durationSec, paceSecPerKm: sel?.avgPaceSecPerKm, elevationM: sel?.elevationM,
        visibility, kudos: 0, kudosedByMe: false, comments: [], pr, routeText: routeText || undefined, photo,
      }) as SocialPost;
      await save('social', np);
    }
    toast(post ? 'Post updated' : 'Posted');
    onDone();
  };

  return (
    <div>
      {!post && recentRuns.length > 0 && (
        <Field label="Share a recent run (optional)">
          <div className="flex gap-1.5 flex-wrap">
            {recentRuns.map((r) => <Chip key={r.id} onClick={() => prefillRun(r)}>{r.kind} {r.distanceKm}km</Chip>)}
          </div>
        </Field>
      )}
      <Field label="Title"><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Morning tempo" /></Field>
      <Field label="Activity type">
        <Segmented value={activityType} onChange={setActivityType} options={[{ value: 'Run', label: 'Run' }, { value: 'Gym', label: 'Gym' }, { value: 'HYROX', label: 'HYROX' }, { value: 'Walk', label: 'Walk' }]} />
      </Field>
      <Field label="Caption" optional><textarea className="field min-h-[72px]" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="How did it go?" /></Field>
      <Field label="Distance (km)" optional><input className="field" inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value)} /></Field>
      <Field label="Route / location" optional hint="Text only — GPS routes require an authorized data source. No coordinates are invented."><input className="field" value={routeText} onChange={(e) => setRouteText(e.target.value)} placeholder="Riverside loop" /></Field>
      <Field label="Photo" optional><input type="file" accept="image/*" onChange={onPhoto} className="text-sm text-muted" />{photo && <img src={photo} className="w-full rounded-xl mt-2 max-h-48 object-cover" />}</Field>
      <Field label="Visibility">
        <Segmented value={visibility} onChange={(v) => setVisibility(v as Visibility)} options={[{ value: 'private', label: '🔒 Private' }, { value: 'followers', label: '👥 Followers' }, { value: 'public', label: '🌍 Public' }]} />
      </Field>
      <label className="flex items-center gap-2 mb-4 text-sm"><input type="checkbox" checked={pr} onChange={(e) => setPr(e.target.checked)} /> Mark as a personal record 🏅</label>
      <button className="btn-primary w-full" onClick={submit}>{post ? 'Save changes' : 'Publish post'}</button>
      <div className="text-[11px] text-muted mt-2">Nothing is published automatically — you choose what and with whom to share. Default visibility keeps health details and exact routes private.</div>
    </div>
  );
}
