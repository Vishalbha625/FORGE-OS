import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { supabaseCircuit, CircuitOpenError } from './circuitBreaker';
import { withRetry } from './retry';
import { sanitizeBio, sanitizeCaption, sanitizeComment, sanitizeDisplayName, sanitizePostTitle, sanitizeText } from './sanitize';
import { compressAvatar, compressFull, compressThumb } from './imageCompressor';
import { todayISO, DEFAULT_TZ } from './dates';

// Community data in Supabase. Only what the athlete chooses to post goes
// through here; health data never does (R1). Every query is also limited by
// row-level security on the server (R6): the filters below are defence in depth.

// ── Types ────────────────────────────────────────────────────────────────────

export type Visibility = 'private' | 'followers' | 'public';

export interface CommunityProfile {
  id: string;
  display_name: string;
  bio?: string;
  goals: string[];
  avatar_path?: string;
  created_at: string;
}

export interface CommunityPost {
  id: string;
  author_id: string;
  event_date: string;
  title: string;
  activity_type: string;
  caption?: string;
  distance_km?: number;
  duration_sec?: number;
  pace_sec_per_km?: number;
  elevation_m?: number;
  station_detail?: string;
  route_text?: string;
  /** Folder "<author>/<post>" holding thumb.webp and full.webp. */
  photo_path?: string;
  is_pr: boolean;
  visibility: Visibility;
  created_at: string;
  updated_at: string;
  author: CommunityProfile;
  kudos_count: number;
  comment_count: number;
  user_has_kudosed: boolean;
}

export interface CommunityComment {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author: CommunityProfile;
}

export interface FollowRelation {
  follower_id: string;
  followee_id: string;
  status: 'pending' | 'accepted';
  created_at: string;
  /** The other person: the follower for followers/requests, the followee for following. */
  profile: CommunityProfile;
}

export interface ServiceResult<T> {
  data: T | null;
  error: string | null;
}

export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CreatePostInput {
  /** Optional client id, so a replayed offline write cannot create a duplicate. */
  id?: string;
  /** YYYY-MM-DD; defaults to today. */
  event_date?: string;
  title: string;
  activity_type: string;
  caption?: string;
  distance_km?: number;
  duration_sec?: number;
  pace_sec_per_km?: number;
  elevation_m?: number;
  station_detail?: string;
  route_text?: string;
  photo?: Blob;
  is_pr?: boolean;
  visibility: Visibility;
}

export type UpdatePostInput = Partial<Omit<CreatePostInput, 'id' | 'photo'>>;

// ── Plumbing ─────────────────────────────────────────────────────────────────

export const NOT_CONFIGURED = 'Community features are not configured.';
const BUCKET = 'post-photos';
const PHOTO_URL_TTL_SEC = 24 * 60 * 60;

const ok = <T>(data: T): ServiceResult<T> => ({ data, error: null });
const fail = <T>(error: string): ServiceResult<T> => ({ data: null, error });

interface ApiError {
  message: string;
  code?: string;
  status?: number;
  statusCode?: string;
}
interface ApiResponse<T> {
  data: T | null;
  error: ApiError | null;
  status?: number;
}

class ServiceError extends Error {
  readonly status?: number;
  readonly code?: string;
  constructor(err: ApiError, status: number | undefined) {
    super(err.message);
    this.name = 'ServiceError';
    this.status = status;
    this.code = err.code;
  }
}

/** HTTP status of a PostgREST or Storage response; undefined for network failures. */
function statusOf(res: ApiResponse<unknown>): number | undefined {
  const s = res.status || res.error?.status || Number(res.error?.statusCode) || undefined;
  return s && s > 0 ? s : undefined;
}

/** Worth retrying and worth counting against the circuit: network and server trouble only. */
function isTransient(status: number | undefined): boolean {
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

const isDuplicate = (err: ApiError | null) => err?.code === '23505' || err?.status === 409 || err?.statusCode === '409';

export function friendlyError(err: unknown, status?: number): string {
  if (err instanceof CircuitOpenError) return err.message;
  const e = (typeof err === 'object' && err !== null ? err : { message: String(err) }) as Partial<ApiError> & { status?: number };
  const code = e.code;
  const s = status ?? e.status;
  const message = e.message ?? 'Something went wrong.';
  if (/failed to fetch|network|load failed|fetch failed/i.test(message) || (s === undefined && !code)) {
    return 'Network error. Check your connection and try again.';
  }
  if (s === 401) return 'Please sign in again.';
  if (code === '42501' || s === 403) return "You don't have permission to do that.";
  if (code === '23505' || s === 409) return 'That already exists.';
  if (code === '23514' || code === '22001') return 'Some of the details are not valid.';
  if (s === 429) return 'Too many requests. Please wait a moment and try again.';
  return message;
}

/**
 * Runs one Supabase operation inside the circuit breaker. Writes are retried
 * with backoff. Client errors (bad input, RLS, duplicates) come back as a
 * result and never trip the circuit; only network and server failures do.
 */
async function run<T = unknown>(
  // Rows are typed by the caller: there is no generated database schema, and
  // the JSON shape is checked by the toX() mappers below.
  op: (client: SupabaseClient) => PromiseLike<ApiResponse<unknown>>,
  opts: { write?: boolean; allowDuplicate?: boolean } = {},
): Promise<ServiceResult<T>> {
  const client = getSupabase();
  if (!client) return fail(NOT_CONFIGURED);
  try {
    const res = await supabaseCircuit.execute(() => {
      const attempt = async () => {
        const r = await op(client);
        const status = statusOf(r);
        if (r.error && isTransient(status)) throw new ServiceError(r.error, status);
        return r;
      };
      return opts.write ? withRetry(attempt) : attempt();
    });
    // A retried insert whose first attempt landed: the row exists, which is what we wanted.
    if (res.error && opts.allowDuplicate && isDuplicate(res.error)) return ok(res.data as T);
    if (res.error) return fail(friendlyError(res.error, statusOf(res)));
    return ok(res.data as T);
  } catch (err) {
    return fail(friendlyError(err));
  }
}

// Optional text: empty after cleaning means "not set" (undefined), never "".
const optionalText = (value: string | undefined, clean: (v: unknown) => string) => {
  const cleaned = clean(value);
  return cleaned ? cleaned : undefined;
};
const cleanActivity = (v: unknown) => sanitizeText(v, { maxLength: 40, singleLine: true });
const cleanStation = (v: unknown) => sanitizeText(v, { maxLength: 2000 });
const cleanRoute = (v: unknown) => sanitizeText(v, { maxLength: 200, singleLine: true });
const cleanGoal = (v: unknown) => sanitizeText(v, { maxLength: 40, singleLine: true });
const finite = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : undefined);
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const newId = () => crypto.randomUUID();

// ── Row mapping (database nulls become undefined) ────────────────────────────

const PROFILE_COLS = 'id, display_name, bio, goals, avatar_path, created_at';
// Foreign keys are named: posts and comments also reach profiles through kudos,
// comments and reports, which PostgREST would otherwise reject as ambiguous.
const POST_SELECT = `*, author:profiles!posts_author_id_fkey(${PROFILE_COLS}), kudos(count), comments(count), my_kudos:kudos(user_id)`;
const COMMENT_SELECT = `id, post_id, author_id, body, created_at, author:profiles!comments_author_id_fkey(${PROFILE_COLS})`;

interface ProfileRow {
  id: string;
  display_name: string;
  bio: string | null;
  goals: string[] | null;
  avatar_path: string | null;
  created_at: string;
}
interface PostRow {
  id: string;
  author_id: string;
  event_date: string;
  title: string;
  activity_type: string;
  caption: string | null;
  distance_km: number | string | null;
  duration_sec: number | null;
  pace_sec_per_km: number | null;
  elevation_m: number | null;
  station_detail: string | null;
  route_text: string | null;
  photo_path: string | null;
  is_pr: boolean;
  visibility: Visibility;
  created_at: string;
  updated_at: string;
  author: ProfileRow | null;
  kudos: { count: number }[] | null;
  comments: { count: number }[] | null;
  my_kudos: { user_id: string }[] | null;
}
interface CommentRow {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author: ProfileRow | null;
}
interface FollowRow {
  follower_id: string;
  followee_id: string;
  status: 'pending' | 'accepted';
  created_at: string;
  profile: ProfileRow | null;
}

const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

export function toProfile(row: ProfileRow | null, fallbackId = ''): CommunityProfile {
  if (!row) return { id: fallbackId, display_name: 'Athlete', goals: [], created_at: '' };
  return {
    id: row.id,
    display_name: row.display_name,
    bio: opt(row.bio),
    goals: row.goals ?? [],
    avatar_path: opt(row.avatar_path),
    created_at: row.created_at,
  };
}

export function toPost(row: PostRow, userId: string): CommunityPost {
  const distance = row.distance_km === null ? undefined : Number(row.distance_km);
  return {
    id: row.id,
    author_id: row.author_id,
    event_date: row.event_date,
    title: row.title,
    activity_type: row.activity_type,
    caption: opt(row.caption),
    distance_km: Number.isFinite(distance) ? distance : undefined,
    duration_sec: opt(row.duration_sec),
    pace_sec_per_km: opt(row.pace_sec_per_km),
    elevation_m: opt(row.elevation_m),
    station_detail: opt(row.station_detail),
    route_text: opt(row.route_text),
    photo_path: opt(row.photo_path),
    is_pr: row.is_pr,
    visibility: row.visibility,
    created_at: row.created_at,
    updated_at: row.updated_at,
    author: toProfile(row.author, row.author_id),
    kudos_count: row.kudos?.[0]?.count ?? 0,
    comment_count: row.comments?.[0]?.count ?? 0,
    user_has_kudosed: (row.my_kudos ?? []).some((k) => k.user_id === userId),
  };
}

const toComment = (row: CommentRow): CommunityComment => ({
  id: row.id,
  post_id: row.post_id,
  author_id: row.author_id,
  body: row.body,
  created_at: row.created_at,
  author: toProfile(row.author, row.author_id),
});

// ── Cursors: "<created_at as returned by the server>|<uuid>" ─────────────────
// The raw timestamp string is kept (microseconds included): a JS Date would
// round it and skip or repeat rows at page boundaries.

export function makeCursor(row: { created_at: string; id: string }): string {
  return `${row.created_at}|${row.id}`;
}

export function parseCursor(cursor: string): { createdAt: string; id: string } | null {
  const i = cursor.lastIndexOf('|');
  if (i <= 0) return null;
  const createdAt = cursor.slice(0, i);
  const id = cursor.slice(i + 1);
  if (!isUuid(id) || Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, id };
}

/** PostgREST filter for the rows after the cursor, in the given direction. */
function cursorFilter(cursor: { createdAt: string; id: string }, direction: 'lt' | 'gt'): string {
  const t = `"${cursor.createdAt}"`; // quoted: the timestamp contains reserved characters
  return `created_at.${direction}.${t},and(created_at.eq.${t},id.${direction}.${cursor.id})`;
}

function paginate<R extends { created_at: string; id: string }, T>(rows: R[], pageSize: number, map: (r: R) => T): PaginatedResult<T> {
  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize);
  const last = page[page.length - 1];
  return { data: page.map(map), nextCursor: hasMore && last ? makeCursor(last) : null, hasMore };
}

// ── Feed ─────────────────────────────────────────────────────────────────────

// Above this many followees the id list would make the URL too long; RLS
// (can_view_post) already limits followers-only posts to accepted followers.
const MAX_FOLLOWEES_IN_FILTER = 150;

/** Visibility filter: public posts, your own, and followers-only posts of people you follow. */
export function feedVisibilityFilter(userId: string, followeeIds: string[]): string {
  const ids = followeeIds.filter(isUuid);
  if (ids.length > MAX_FOLLOWEES_IN_FILTER) return `visibility.in.(public,followers),author_id.eq.${userId}`;
  const followers = ids.length ? `,and(visibility.eq.followers,author_id.in.(${ids.join(',')}))` : '';
  return `visibility.eq.public,author_id.eq.${userId}${followers}`;
}

/** Ids of the people you follow (accepted). */
export async function getFollowingIds(userId: string): Promise<ServiceResult<string[]>> {
  const res = await run<{ followee_id: string }[]>((c) => c.from('follows').select('followee_id').eq('follower_id', userId).eq('status', 'accepted'));
  if (res.error || !res.data) return fail(res.error ?? 'Could not load who you follow.');
  return ok(res.data.map((r) => r.followee_id));
}

/**
 * Public posts, your own, and followers-only posts from people you follow,
 * newest first. Pass `followeeIds` to reuse a list you already have (the feed
 * hook caches it between polls); otherwise it is fetched.
 */
export async function fetchFeed(
  userId: string,
  cursor?: string,
  pageSize = 20,
  followeeIds?: string[],
): Promise<ServiceResult<PaginatedResult<CommunityPost>>> {
  if (!isUuid(userId)) return fail('Please sign in again.');
  const after = cursor ? parseCursor(cursor) : null;
  if (cursor && !after) return fail('Invalid page cursor.');
  let following = followeeIds;
  if (!following) {
    const f = await getFollowingIds(userId);
    if (f.error || !f.data) return fail(f.error ?? 'Could not load the feed.');
    following = f.data;
  }
  const visibility = feedVisibilityFilter(userId, following);
  const res = await run<PostRow[]>((c) => {
    let q = c
      .from('posts')
      .select(POST_SELECT)
      .or(visibility)
      .eq('my_kudos.user_id', userId);
    if (after) q = q.or(cursorFilter(after, 'lt'));
    return q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(pageSize + 1);
  });
  if (res.error || !res.data) return fail(res.error ?? 'Could not load the feed.');
  return ok(paginate(res.data, pageSize, (r) => toPost(r, userId)));
}

/** One post with author, counts and your kudos state. */
export async function getPost(postId: string, userId: string): Promise<ServiceResult<CommunityPost>> {
  const res = await run<PostRow | null>((c) => c.from('posts').select(POST_SELECT).eq('id', postId).eq('my_kudos.user_id', userId).maybeSingle());
  if (res.error) return fail(res.error);
  return res.data ? ok(toPost(res.data, userId)) : fail('Post not found.');
}

// ── Posts ────────────────────────────────────────────────────────────────────

export async function createPost(userId: string, input: CreatePostInput): Promise<ServiceResult<CommunityPost>> {
  const title = sanitizePostTitle(input.title);
  if (!title) return fail('Please add a title.');
  const activity = cleanActivity(input.activity_type);
  if (!activity) return fail('Please choose an activity type.');
  const id = input.id && isUuid(input.id) ? input.id : newId();

  let photoPath: string | undefined;
  if (input.photo) {
    const upload = await uploadPostPhoto(userId, id, input.photo);
    if (upload.error || !upload.data) return fail(upload.error ?? 'Photo upload failed.');
    photoPath = upload.data;
  }

  const row = {
    id,
    author_id: userId,
    event_date: input.event_date ?? todayISO(DEFAULT_TZ),
    title,
    activity_type: activity,
    caption: optionalText(input.caption, sanitizeCaption),
    distance_km: finite(input.distance_km),
    duration_sec: finite(input.duration_sec),
    pace_sec_per_km: finite(input.pace_sec_per_km),
    elevation_m: finite(input.elevation_m),
    station_detail: optionalText(input.station_detail, cleanStation),
    route_text: optionalText(input.route_text, cleanRoute),
    photo_path: photoPath,
    is_pr: input.is_pr ?? false,
    visibility: input.visibility,
  };
  const inserted = await run((c) => c.from('posts').insert(row), { write: true, allowDuplicate: true });
  if (inserted.error) {
    if (photoPath) await removePhotos(userId, id); // don't leave orphaned files using storage
    return fail(inserted.error);
  }
  return getPost(id, userId);
}

export async function updatePost(postId: string, userId: string, updates: UpdatePostInput): Promise<ServiceResult<CommunityPost>> {
  const has = (k: keyof UpdatePostInput) => Object.prototype.hasOwnProperty.call(updates, k);
  // A key that is present changes the field; an empty value clears it.
  const patch: Record<string, string | number | boolean | null> = {};
  if (has('title')) {
    const title = sanitizePostTitle(updates.title);
    if (!title) return fail('Please add a title.');
    patch.title = title;
  }
  if (has('activity_type')) {
    const activity = cleanActivity(updates.activity_type);
    if (!activity) return fail('Please choose an activity type.');
    patch.activity_type = activity;
  }
  if (has('event_date') && updates.event_date) patch.event_date = updates.event_date;
  if (has('caption')) patch.caption = optionalText(updates.caption, sanitizeCaption) ?? null;
  if (has('station_detail')) patch.station_detail = optionalText(updates.station_detail, cleanStation) ?? null;
  if (has('route_text')) patch.route_text = optionalText(updates.route_text, cleanRoute) ?? null;
  for (const k of ['distance_km', 'duration_sec', 'pace_sec_per_km', 'elevation_m'] as const) {
    if (has(k)) patch[k] = finite(updates[k]) ?? null;
  }
  if (has('is_pr')) patch.is_pr = Boolean(updates.is_pr);
  if (has('visibility') && updates.visibility) patch.visibility = updates.visibility;
  if (Object.keys(patch).length === 0) return getPost(postId, userId);

  const res = await run((c) => c.from('posts').update(patch).eq('id', postId).eq('author_id', userId), { write: true });
  if (res.error) return fail(res.error);
  return getPost(postId, userId);
}

export async function deletePost(postId: string, userId: string): Promise<ServiceResult<void>> {
  // Best effort: a file left behind is wasted space, a post left behind is worse.
  await removePhotos(userId, postId);
  const res = await run((c) => c.from('posts').delete().eq('id', postId).eq('author_id', userId), { write: true });
  return res.error ? fail(res.error) : ok(undefined);
}

// ── Photos ───────────────────────────────────────────────────────────────────

const photoFile = (base: string, variant: 'thumb' | 'full') => `${base}/${variant}.webp`;

async function removePhotos(userId: string, postId: string): Promise<void> {
  const base = `${userId}/${postId}`;
  const res = await run((c) => c.storage.from(BUCKET).remove([photoFile(base, 'thumb'), photoFile(base, 'full')]), { write: true });
  if (res.error) console.warn('Could not remove post photos.', res.error);
  photoUrlCache.delete(photoFile(base, 'thumb'));
  photoUrlCache.delete(photoFile(base, 'full'));
}

/** Compresses to a feed thumbnail and a full-size copy, uploads both, returns the folder path. */
export async function uploadPostPhoto(userId: string, postId: string, file: Blob): Promise<ServiceResult<string>> {
  if (!getSupabase()) return fail(NOT_CONFIGURED);
  let thumb: Awaited<ReturnType<typeof compressThumb>>;
  let full: Awaited<ReturnType<typeof compressFull>>;
  try {
    [thumb, full] = await Promise.all([compressThumb(file), compressFull(file)]);
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'This photo could not be prepared.');
  }
  if (!thumb.withinLimit || !full.withinLimit) {
    console.warn(`Photo is over its size target (thumb ${thumb.sizeKB} KB, full ${full.sizeKB} KB). Uploading anyway.`);
  }
  const base = `${userId}/${postId}`;
  // Names stay .webp even when Safari had to encode JPEG: the content type says which.
  const upload = (variant: 'thumb' | 'full', blob: Blob) =>
    run((c) => c.storage.from(BUCKET).upload(photoFile(base, variant), blob, { contentType: blob.type, upsert: true, cacheControl: '86400' }), { write: true });
  const [t, f] = await Promise.all([upload('thumb', thumb.blob), upload('full', full.blob)]);
  const error = t.error ?? f.error;
  if (error) {
    if (!t.error || !f.error) await removePhotos(userId, postId);
    return fail(error);
  }
  return ok(base);
}

/** A 24-hour signed URL for one variant, or null if it can't be made. */
export function getPhotoUrl(photoPath: string, variant: 'thumb' | 'full' = 'thumb'): Promise<string | null> {
  return signUrl(photoFile(photoPath, variant));
}

// Signed URLs are reused instead of re-signed on every render. Module level, not React state.
const PHOTO_CACHE_MAX = 200;
const REUSE_MARGIN_MS = 60 * 60 * 1000; // re-sign when less than an hour is left
const CACHE_TTL_MS = 23 * 60 * 60 * 1000; // an hour short of the real expiry
const photoUrlCache = new Map<string, { url: string; expiresAt: number }>();
const photoUrlInFlight = new Map<string, Promise<string | null>>();

export function getCachedPhotoUrl(photoPath: string, variant: 'thumb' | 'full' = 'thumb'): Promise<string | null> {
  return cachedSignedUrl(photoFile(photoPath, variant));
}

/** Signed URL for a profile photo (its full object path, e.g. "<user>/avatar.webp"). */
export function getCachedAvatarUrl(avatarPath: string): Promise<string | null> {
  return cachedSignedUrl(avatarPath);
}

async function signUrl(objectPath: string): Promise<string | null> {
  const res = await run<{ signedUrl: string }>((c) => c.storage.from(BUCKET).createSignedUrl(objectPath, PHOTO_URL_TTL_SEC));
  return res.data?.signedUrl ?? null;
}

async function cachedSignedUrl(key: string): Promise<string | null> {
  const hit = photoUrlCache.get(key);
  if (hit && hit.expiresAt - Date.now() > REUSE_MARGIN_MS) return hit.url;
  const pending = photoUrlInFlight.get(key);
  if (pending) return pending; // a feed renders the same photo in several places at once

  const request = signUrl(key)
    .then((url) => {
      if (url) {
        if (!photoUrlCache.has(key) && photoUrlCache.size >= PHOTO_CACHE_MAX) evictEarliest();
        photoUrlCache.set(key, { url, expiresAt: Date.now() + CACHE_TTL_MS });
      }
      return url;
    })
    .finally(() => photoUrlInFlight.delete(key));
  photoUrlInFlight.set(key, request);
  return request;
}

function evictEarliest(): void {
  let oldestKey: string | undefined;
  let oldest = Infinity;
  for (const [k, v] of photoUrlCache) {
    if (v.expiresAt < oldest) {
      oldest = v.expiresAt;
      oldestKey = k;
    }
  }
  if (oldestKey !== undefined) photoUrlCache.delete(oldestKey);
}

/** Forget cached signed URLs (on sign-out, and in tests). */
export function clearPhotoUrlCache(): void {
  photoUrlCache.clear();
  photoUrlInFlight.clear();
}

export const photoUrlCacheSize = () => photoUrlCache.size;

// ── Kudos ────────────────────────────────────────────────────────────────────

/** Returns the new state: true when the post now has your kudos. */
export async function toggleKudos(postId: string, userId: string, currentlyKudosed: boolean): Promise<ServiceResult<boolean>> {
  if (currentlyKudosed) {
    const res = await run((c) => c.from('kudos').delete().eq('post_id', postId).eq('user_id', userId), { write: true });
    return res.error ? fail(res.error) : ok(false);
  }
  const res = await run((c) => c.from('kudos').insert({ post_id: postId, user_id: userId }), { write: true, allowDuplicate: true });
  return res.error ? fail(res.error) : ok(true);
}

// ── Comments ─────────────────────────────────────────────────────────────────

/** Oldest first, like a conversation. */
export async function fetchComments(postId: string, cursor?: string, pageSize = 20): Promise<ServiceResult<PaginatedResult<CommunityComment>>> {
  const after = cursor ? parseCursor(cursor) : null;
  if (cursor && !after) return fail('Invalid page cursor.');
  const res = await run<CommentRow[]>((c) => {
    let q = c.from('comments').select(COMMENT_SELECT).eq('post_id', postId);
    if (after) q = q.or(cursorFilter(after, 'gt'));
    return q.order('created_at', { ascending: true }).order('id', { ascending: true }).limit(pageSize + 1);
  });
  if (res.error || !res.data) return fail(res.error ?? 'Could not load comments.');
  return ok(paginate(res.data, pageSize, toComment));
}

export async function addComment(postId: string, userId: string, body: string, id: string = newId()): Promise<ServiceResult<CommunityComment>> {
  const text = sanitizeComment(body);
  if (!text) return fail('Please write a comment.');
  const commentId = isUuid(id) ? id : newId();
  const inserted = await run((c) => c.from('comments').insert({ id: commentId, post_id: postId, author_id: userId, body: text }), { write: true, allowDuplicate: true });
  if (inserted.error) return fail(inserted.error);
  const res = await run<CommentRow | null>((c) => c.from('comments').select(COMMENT_SELECT).eq('id', commentId).maybeSingle());
  if (res.error) return fail(res.error);
  return res.data ? ok(toComment(res.data)) : fail('Comment not found.');
}

export async function deleteComment(commentId: string, userId: string): Promise<ServiceResult<void>> {
  const res = await run((c) => c.from('comments').delete().eq('id', commentId).eq('author_id', userId), { write: true });
  return res.error ? fail(res.error) : ok(undefined);
}

// ── Follows ──────────────────────────────────────────────────────────────────

const followSelect = (side: 'follower' | 'followee') =>
  `follower_id, followee_id, status, created_at, profile:profiles!follows_${side}_id_fkey(${PROFILE_COLS})`;

const toFollow = (side: 'follower' | 'followee') => (row: FollowRow): FollowRelation => ({
  follower_id: row.follower_id,
  followee_id: row.followee_id,
  status: row.status,
  created_at: row.created_at,
  profile: toProfile(row.profile, side === 'follower' ? row.follower_id : row.followee_id),
});

export async function requestFollow(followerId: string, followeeId: string): Promise<ServiceResult<void>> {
  const res = await run((c) => c.from('follows').insert({ follower_id: followerId, followee_id: followeeId, status: 'pending' }), { write: true, allowDuplicate: true });
  return res.error ? fail(res.error) : ok(undefined);
}

export async function acceptFollow(followerId: string, followeeId: string): Promise<ServiceResult<void>> {
  const res = await run((c) => c.from('follows').update({ status: 'accepted' }).eq('follower_id', followerId).eq('followee_id', followeeId), { write: true });
  return res.error ? fail(res.error) : ok(undefined);
}

export async function removeFollow(followerId: string, followeeId: string): Promise<ServiceResult<void>> {
  const res = await run((c) => c.from('follows').delete().eq('follower_id', followerId).eq('followee_id', followeeId), { write: true });
  return res.error ? fail(res.error) : ok(undefined);
}

async function listFollows(column: 'follower_id' | 'followee_id', userId: string, status: 'pending' | 'accepted', side: 'follower' | 'followee') {
  const res = await run<FollowRow[]>((c) =>
    c.from('follows').select(followSelect(side)).eq(column, userId).eq('status', status).order('created_at', { ascending: false }),
  );
  if (res.error || !res.data) return fail<FollowRelation[]>(res.error ?? 'Could not load follows.');
  return ok(res.data.map(toFollow(side)));
}

export const getFollowers = (userId: string) => listFollows('followee_id', userId, 'accepted', 'follower');
export const getFollowing = (userId: string) => listFollows('follower_id', userId, 'accepted', 'followee');
export const getPendingFollowRequests = (userId: string) => listFollows('followee_id', userId, 'pending', 'follower');

// ── Blocks ───────────────────────────────────────────────────────────────────

export async function blockUser(blockerId: string, blockedId: string): Promise<ServiceResult<void>> {
  // Drop follows both ways first, one after the other. The block goes in even
  // if that fails: a block hides everything in both directions on its own.
  for (const [a, b] of [[blockerId, blockedId], [blockedId, blockerId]] as const) {
    const removed = await removeFollow(a, b);
    if (removed.error) console.warn('Could not remove a follow before blocking.', removed.error);
  }
  const res = await run((c) => c.from('blocks').insert({ blocker_id: blockerId, blocked_id: blockedId }), { write: true, allowDuplicate: true });
  return res.error ? fail(res.error) : ok(undefined);
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<ServiceResult<void>> {
  const res = await run((c) => c.from('blocks').delete().eq('blocker_id', blockerId).eq('blocked_id', blockedId), { write: true });
  return res.error ? fail(res.error) : ok(undefined);
}

// ── Reports ──────────────────────────────────────────────────────────────────

export async function reportContent(
  reporterId: string,
  target: { postId?: string; commentId?: string; userId?: string },
  reason: string,
): Promise<ServiceResult<void>> {
  const text = sanitizeText(reason, { maxLength: 500 });
  if (!text) return fail('Please say what is wrong.');
  if (!target.postId && !target.commentId && !target.userId) return fail('Nothing to report.');
  // Insert only: users cannot read reports back, so no row is returned.
  const res = await run(
    (c) => c.from('reports').insert({ reporter_id: reporterId, post_id: target.postId, comment_id: target.commentId, user_id: target.userId, reason: text }),
    { write: true },
  );
  return res.error ? fail(res.error) : ok(undefined);
}

// ── Profiles ─────────────────────────────────────────────────────────────────

export async function getProfile(userId: string): Promise<ServiceResult<CommunityProfile>> {
  const res = await run<ProfileRow | null>((c) => c.from('profiles').select(PROFILE_COLS).eq('id', userId).maybeSingle());
  if (res.error) return fail(res.error);
  return res.data ? ok(toProfile(res.data)) : fail('Profile not found.');
}

export async function updateProfile(
  userId: string,
  updates: { display_name?: string; bio?: string; goals?: string[] },
): Promise<ServiceResult<CommunityProfile>> {
  const patch: Record<string, string | string[] | null> = {};
  if (updates.display_name !== undefined) {
    const name = sanitizeDisplayName(updates.display_name);
    if (!name) return fail('Please enter your name.');
    patch.display_name = name;
  }
  if (updates.bio !== undefined) patch.bio = optionalText(updates.bio, sanitizeBio) ?? null;
  if (updates.goals !== undefined) patch.goals = updates.goals.map(cleanGoal).filter(Boolean).slice(0, 10);
  if (Object.keys(patch).length === 0) return getProfile(userId);
  const res = await run<ProfileRow>((c) => c.from('profiles').update(patch).eq('id', userId).select(PROFILE_COLS).single(), { write: true });
  if (res.error || !res.data) return fail(res.error ?? 'Could not update the profile.');
  return ok(toProfile(res.data));
}

// ── Profiles, follows and search (Phase 5) ───────────────────────────────────

export type FollowStatus = 'none' | 'pending' | 'accepted';

/** Where you stand with someone: not following, requested, or following. */
export async function getFollowStatus(followerId: string, followeeId: string): Promise<ServiceResult<FollowStatus>> {
  const res = await run<{ status: 'pending' | 'accepted' } | null>((c) =>
    c.from('follows').select('status').eq('follower_id', followerId).eq('followee_id', followeeId).maybeSingle(),
  );
  if (res.error) return fail(res.error);
  return ok(res.data?.status ?? 'none');
}

/**
 * Posts on someone's profile, newest first: everything if it's you, public and
 * followers-only if you follow them, public otherwise. RLS hides everything
 * if either of you blocked the other.
 */
export async function getProfilePosts(
  profileUserId: string,
  viewerId: string,
  cursor?: string,
  pageSize = 20,
): Promise<ServiceResult<PaginatedResult<CommunityPost>>> {
  if (!isUuid(profileUserId) || !isUuid(viewerId)) return fail('Profile not found.');
  const after = cursor ? parseCursor(cursor) : null;
  if (cursor && !after) return fail('Invalid page cursor.');
  let visible: Visibility[] = ['public', 'followers', 'private'];
  if (profileUserId !== viewerId) {
    const status = await getFollowStatus(viewerId, profileUserId);
    if (status.error) return fail(status.error);
    visible = status.data === 'accepted' ? ['public', 'followers'] : ['public'];
  }
  const res = await run<PostRow[]>((c) => {
    let q = c.from('posts').select(POST_SELECT).eq('author_id', profileUserId).in('visibility', visible).eq('my_kudos.user_id', viewerId);
    if (after) q = q.or(cursorFilter(after, 'lt'));
    return q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(pageSize + 1);
  });
  if (res.error || !res.data) return fail(res.error ?? 'Could not load posts.');
  return ok(paginate(res.data, pageSize, (r) => toPost(r, viewerId)));
}

/** Posts of this user that you can see (all of them, if it's you). */
export async function getPostCount(userId: string): Promise<ServiceResult<number>> {
  // HEAD request: no rows travel, only the count.
  const res = await run<number | null>((c) =>
    c.from('posts').select('id', { count: 'exact', head: true }).eq('author_id', userId).then((r) => ({ data: r.count, error: r.error, status: r.status })),
  );
  if (res.error) return fail(res.error);
  return ok(res.data ?? 0);
}

/** Both counts in one call (the profile header needs both). */
export async function getFollowCounts(userId: string): Promise<ServiceResult<{ followers: number; following: number }>> {
  const res = await run<{ followers: number; following: number }[]>((c) => c.rpc('profile_follow_counts', { p_user: userId }));
  if (res.error || !res.data) return fail(res.error ?? 'Could not load follow counts.');
  const row = res.data[0];
  return ok({ followers: Number(row?.followers ?? 0), following: Number(row?.following ?? 0) });
}

export async function getFollowerCount(userId: string): Promise<ServiceResult<number>> {
  const res = await getFollowCounts(userId);
  return res.data ? ok(res.data.followers) : fail(res.error ?? 'Could not load follow counts.');
}

export async function getFollowingCount(userId: string): Promise<ServiceResult<number>> {
  const res = await getFollowCounts(userId);
  return res.data ? ok(res.data.following) : fail(res.error ?? 'Could not load follow counts.');
}

/** Accepted followers of, or people followed by, any profile you can see. */
export async function getFollowList(userId: string, direction: 'followers' | 'following'): Promise<ServiceResult<CommunityProfile[]>> {
  const res = await run<ProfileRow[]>((c) => c.rpc('profile_follows', { p_user: userId, p_direction: direction }));
  if (res.error || !res.data) return fail(res.error ?? 'Could not load the list.');
  return ok(res.data.map((r) => toProfile(r)));
}

/** Escape LIKE wildcards so a search for "50%" means the text "50%". */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/** Athletes whose name contains the query. RLS already hides anyone blocked either way. */
export async function searchProfiles(query: string, currentUserId: string, limit = 20): Promise<ServiceResult<CommunityProfile[]>> {
  const q = sanitizeText(query, { maxLength: 60, singleLine: true });
  if (!q) return ok([]);
  const res = await run<ProfileRow[]>((c) =>
    c.from('profiles').select(PROFILE_COLS).ilike('display_name', `%${escapeLike(q)}%`).neq('id', currentUserId).order('display_name').limit(limit),
  );
  if (res.error || !res.data) return fail(res.error ?? 'Search failed.');
  return ok(res.data.map((r) => toProfile(r)));
}

const avatarFile = (userId: string) => `${userId}/avatar.webp`;

/** Compress, upload to "<user>/avatar.webp" (replacing the old one) and save it on the profile. */
export async function uploadAvatar(userId: string, file: Blob): Promise<ServiceResult<string>> {
  if (!getSupabase()) return fail(NOT_CONFIGURED);
  let avatar: Awaited<ReturnType<typeof compressAvatar>>;
  try {
    avatar = await compressAvatar(file);
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'This photo could not be prepared.');
  }
  const path = avatarFile(userId);
  const up = await run((c) => c.storage.from(BUCKET).upload(path, avatar.blob, { contentType: avatar.blob.type, upsert: true, cacheControl: '3600' }), { write: true });
  if (up.error) return fail(up.error);
  photoUrlCache.delete(path); // the old signed URL would show the old photo
  const saved = await run((c) => c.from('profiles').update({ avatar_path: path }).eq('id', userId), { write: true });
  if (saved.error) return fail(saved.error);
  return ok(path);
}

/** People you blocked (only you can list them), newest first. */
export async function getBlockedUsers(userId: string): Promise<ServiceResult<CommunityProfile[]>> {
  const res = await run<{ id: string; display_name: string; avatar_path: string | null; blocked_at: string }[]>((c) =>
    c.rpc('get_blocked_users', { blocker: userId }),
  );
  if (res.error || !res.data) return fail(res.error ?? 'Could not load your blocked list.');
  return ok(res.data.map((r) => ({ id: r.id, display_name: r.display_name, avatar_path: opt(r.avatar_path), goals: [], created_at: r.blocked_at })));
}
