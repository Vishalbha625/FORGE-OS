import type { SupabaseClient } from '@supabase/supabase-js';

// A small in-memory Supabase for multi-step journeys. Unlike the recording
// fake in ../fakeSupabase.ts it keeps state, so a post created in one step is
// in the feed in the next. Reads and writes go through the same rules as the
// row-level security policies in supabase/schema.sql, social.sql, unblock.sql
// and storage.sql (blocks hide everything both ways, followers-only posts need
// an accepted follow, reports are write-only). Those policies themselves are
// tested against real Postgres by supabase/tests/rls_test.sql and api.sh.

type Row = Record<string, unknown>;
export type Table = 'profiles' | 'posts' | 'kudos' | 'comments' | 'follows' | 'blocks' | 'reports';
type Pred = (r: Row) => boolean;

export interface LoggedCall {
  table: string;
  op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' | 'rpc' | 'upload' | 'remove' | 'sign';
  as: string | null;
}

interface Result {
  data: unknown;
  error: { message: string; code?: string } | null;
  status: number;
  count?: number | null;
}

const RLS_DENIED = { message: 'new row violates row-level security policy', code: '42501' };
const DUPLICATE = { message: 'duplicate key value violates unique constraint', code: '23505' };

const KEYS: Record<Table, string[]> = {
  profiles: ['id'],
  posts: ['id'],
  comments: ['id'],
  reports: ['id'],
  kudos: ['post_id', 'user_id'],
  follows: ['follower_id', 'followee_id'],
  blocks: ['blocker_id', 'blocked_id'],
};

const POST_COLUMNS = ['caption', 'distance_km', 'duration_sec', 'pace_sec_per_km', 'elevation_m', 'station_detail', 'route_text', 'photo_path'];

export class FakeBackend {
  readonly tables: Record<Table, Row[]> = { profiles: [], posts: [], kudos: [], comments: [], follows: [], blocks: [], reports: [] };
  readonly objects = new Map<string, Blob>();
  readonly log: LoggedCall[] = [];
  /** auth.uid(): who the requests are made as. */
  uid: string | null = null;
  private tick = 0;

  /** Monotonic timestamps with microseconds, like Postgres returns. */
  now(): string {
    this.tick++;
    return new Date(Date.UTC(2026, 9, 15, 6, 0, 0) + this.tick * 1000).toISOString().replace('Z', `${String(this.tick).padStart(3, '0')}+00:00`);
  }

  as(userId: string | null): this {
    this.uid = userId;
    return this;
  }

  addUser(id: string, displayName: string): void {
    this.tables.profiles.push({ id, display_name: displayName, bio: null, goals: [], avatar_path: null, created_at: this.now(), updated_at: this.now() });
  }

  calls(table: string, op: LoggedCall['op']): LoggedCall[] {
    return this.log.filter((c) => c.table === table && c.op === op);
  }

  // ── The policies ──────────────────────────────────────────────────────────

  blockedBetween(a: string | null, b: unknown): boolean {
    return this.tables.blocks.some((x) => (x.blocker_id === a && x.blocked_id === b) || (x.blocker_id === b && x.blocked_id === a));
  }

  canViewPost(author: unknown, visibility: unknown): boolean {
    const me = this.uid;
    if (!me) return false;
    if (author === me) return true;
    if (this.blockedBetween(me, author)) return false;
    if (visibility === 'public') return true;
    if (visibility === 'followers') return this.tables.follows.some((f) => f.follower_id === me && f.followee_id === author && f.status === 'accepted');
    return false;
  }

  canViewPostId(postId: unknown): boolean {
    const p = this.tables.posts.find((x) => x.id === postId);
    return !!p && this.canViewPost(p.author_id, p.visibility);
  }

  /** Rows the current user may read (select policy, also the `using` of update and delete). */
  private readable(table: Table, r: Row): boolean {
    const me = this.uid;
    switch (table) {
      case 'profiles':
        return !!me && !this.blockedBetween(me, r.id);
      case 'follows':
        return r.follower_id === me || r.followee_id === me;
      case 'blocks':
        return r.blocker_id === me;
      case 'posts':
        return this.canViewPost(r.author_id, r.visibility);
      case 'comments':
        return this.canViewPostId(r.post_id) && !this.blockedBetween(me, r.author_id);
      case 'kudos':
        return this.canViewPostId(r.post_id);
      case 'reports':
        return false; // no select policy: write-only
    }
  }

  private mayWrite(table: Table, op: 'update' | 'delete', r: Row): boolean {
    const me = this.uid;
    switch (table) {
      case 'profiles':
        return op === 'update' && r.id === me;
      case 'follows':
        return op === 'update' ? r.followee_id === me : r.follower_id === me || r.followee_id === me;
      case 'blocks':
        return r.blocker_id === me;
      case 'posts':
        return r.author_id === me;
      case 'comments':
        return op === 'delete' && (r.author_id === me || this.tables.posts.some((p) => p.id === r.post_id && p.author_id === me));
      case 'kudos':
        return op === 'delete' && r.user_id === me;
      case 'reports':
        return false;
    }
  }

  private insertAllowed(table: Table, r: Row): boolean {
    const me = this.uid;
    if (!me) return false;
    switch (table) {
      case 'profiles':
        return r.id === me;
      case 'follows':
        return r.follower_id === me && r.status === 'pending' && !this.blockedBetween(r.follower_id as string, r.followee_id);
      case 'blocks':
        return r.blocker_id === me;
      case 'posts':
        return r.author_id === me;
      case 'comments':
        return r.author_id === me && this.canViewPostId(r.post_id);
      case 'kudos':
        return r.user_id === me && this.canViewPostId(r.post_id);
      case 'reports':
        return r.reporter_id === me;
    }
  }

  // ── Statements ────────────────────────────────────────────────────────────

  private withDefaults(table: Table, input: Row): Row {
    // JSON drops undefined: those columns take their database default (null).
    const r: Row = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    if (KEYS[table][0] === 'id' && r.id === undefined) r.id = crypto.randomUUID();
    r.created_at ??= this.now();
    if (table === 'posts') {
      r.updated_at = r.created_at;
      for (const c of POST_COLUMNS) r[c] ??= null;
      r.is_pr ??= false;
    }
    if (table === 'profiles') {
      r.bio ??= null;
      r.avatar_path ??= null;
      r.goals ??= [];
    }
    if (table === 'follows') r.status ??= 'pending';
    return r;
  }

  private sameKey(table: Table, a: Row, b: Row): boolean {
    return KEYS[table].every((k) => a[k] === b[k]);
  }

  insert(table: Table, rows: Row[], opts: { upsert?: boolean; ignoreDuplicates?: boolean } = {}): Result {
    for (const input of rows) {
      const r = this.withDefaults(table, input);
      if (!this.insertAllowed(table, r)) return { data: null, error: RLS_DENIED, status: 403 };
      if (this.tables[table].some((x) => this.sameKey(table, x, r))) {
        if (opts.upsert && opts.ignoreDuplicates) continue;
        return { data: null, error: DUPLICATE, status: 409 };
      }
      this.tables[table].push(r);
    }
    return { data: null, error: null, status: 201 };
  }

  update(table: Table, patch: Row, where: Pred): Row[] {
    const hit = this.tables[table].filter((r) => this.readable(table, r) && this.mayWrite(table, 'update', r) && where(r));
    for (const r of hit) {
      Object.assign(r, patch);
      if (table === 'posts' || table === 'profiles') r.updated_at = this.now();
    }
    return hit;
  }

  delete(table: Table, where: Pred): void {
    const gone = new Set(this.tables[table].filter((r) => this.readable(table, r) && this.mayWrite(table, 'delete', r) && where(r)));
    this.tables[table] = this.tables[table].filter((r) => !gone.has(r));
    if (table === 'posts') {
      // on delete cascade
      const ids = new Set([...gone].map((p) => p.id));
      this.tables.comments = this.tables.comments.filter((c) => !ids.has(c.post_id));
      this.tables.kudos = this.tables.kudos.filter((k) => !ids.has(k.post_id));
    }
  }

  select(table: Table, columns: string, where: Pred, embedFilters: Map<string, unknown>): Row[] {
    return this.tables[table].filter((r) => this.readable(table, r) && where(r)).map((r) => this.shape(table, r, columns, embedFilters));
  }

  private profileOf(id: unknown): Row | null {
    const p = this.tables.profiles.find((x) => x.id === id);
    return p && this.readable('profiles', p) ? { ...p } : null;
  }

  /** The row as the select string asks for it, with embedded relations. */
  private shape(table: Table, r: Row, columns: string, embedFilters: Map<string, unknown>): Row {
    const out: Row = { ...r };
    const profileEmbed = /(\w+):profiles!\w+?_(author|follower|followee)_id_fkey\(/g;
    for (const m of columns.matchAll(profileEmbed)) out[m[1]] = this.profileOf(r[`${m[2]}_id`]);
    if (table === 'posts') {
      if (columns.includes('kudos(count)')) out.kudos = [{ count: this.tables.kudos.filter((k) => k.post_id === r.id && this.readable('kudos', k)).length }];
      if (columns.includes('comments(count)')) out.comments = [{ count: this.tables.comments.filter((c) => c.post_id === r.id && this.readable('comments', c)).length }];
      if (columns.includes('my_kudos:kudos(user_id)')) {
        const who = embedFilters.get('my_kudos.user_id');
        out.my_kudos = this.tables.kudos.filter((k) => k.post_id === r.id && (who === undefined || k.user_id === who)).map((k) => ({ user_id: k.user_id }));
      }
    }
    return out;
  }

  rpc(fn: string, args: Row): Result {
    const me = this.uid;
    const f = this.tables.follows;
    if (fn === 'profile_follow_counts') {
      const u = args.p_user;
      if (!me || this.blockedBetween(me, u)) return { data: [], error: null, status: 200 };
      const followers = f.filter((x) => x.followee_id === u && x.status === 'accepted' && !this.blockedBetween(me, x.follower_id)).length;
      const following = f.filter((x) => x.follower_id === u && x.status === 'accepted' && !this.blockedBetween(me, x.followee_id)).length;
      return { data: [{ followers, following }], error: null, status: 200 };
    }
    if (fn === 'profile_follows') {
      const u = args.p_user;
      if (!me || this.blockedBetween(me, u)) return { data: [], error: null, status: 200 };
      const followers = args.p_direction === 'followers';
      const rows = f
        .filter((x) => x.status === 'accepted' && (followers ? x.followee_id : x.follower_id) === u)
        .map((x) => this.tables.profiles.find((p) => p.id === (followers ? x.follower_id : x.followee_id)))
        .filter((p): p is Row => !!p && !this.blockedBetween(me, p.id));
      return { data: rows, error: null, status: 200 };
    }
    if (fn === 'get_blocked_users') {
      if (!me || args.blocker !== me) return { data: [], error: null, status: 200 };
      const rows = this.tables.blocks
        .filter((b) => b.blocker_id === me)
        .map((b) => ({ ...this.tables.profiles.find((p) => p.id === b.blocked_id), blocked_at: b.created_at }));
      return { data: rows, error: null, status: 200 };
    }
    return { data: null, error: { message: `function ${fn} does not exist` }, status: 404 };
  }

  // ── The client ────────────────────────────────────────────────────────────

  client(): SupabaseClient {
    const backend = this;
    const record = (table: string, op: LoggedCall['op']) => backend.log.push({ table, op, as: backend.uid });
    const ownFolder = (path: string) => path.split('/')[0] === backend.uid;
    const bucket = {
      upload: async (path: string, blob: Blob) => {
        record('storage', 'upload');
        if (!ownFolder(path)) return { data: null, error: { ...RLS_DENIED, statusCode: '403' } };
        backend.objects.set(path, blob);
        return { data: { path }, error: null };
      },
      remove: async (paths: string[]) => {
        record('storage', 'remove');
        for (const p of paths) if (ownFolder(p)) backend.objects.delete(p);
        return { data: [], error: null };
      },
      createSignedUrl: async (path: string) => {
        record('storage', 'sign');
        return backend.objects.has(path) ? { data: { signedUrl: `https://files.test/${path}?sig=1` }, error: null } : { data: null, error: { message: 'Object not found', statusCode: '404' } };
      },
    };
    const client = {
      from: (table: Table) => new Query(backend, table, record),
      rpc: (fn: string, args: Row) => {
        record(`rpc:${fn}`, 'rpc');
        return Promise.resolve(backend.rpc(fn, args));
      },
      storage: { from: () => bucket },
      auth: {
        getSession: async () => ({ data: { session: backend.uid ? { user: { id: backend.uid } } : null }, error: null }),
        signUp: async ({ email, options }: { email: string; options?: { data?: Row } }) => {
          const id = crypto.randomUUID();
          backend.uid = id; // email confirmation off: signed in straight away
          const user = { id, email, user_metadata: options?.data ?? {} };
          return { data: { user, session: { user, access_token: 'test' } }, error: null };
        },
      },
    };
    return client as unknown as SupabaseClient;
  }
}

type Op = { kind: 'select'; columns: string; head: boolean } | { kind: 'insert'; rows: Row[]; upsert: boolean; ignoreDuplicates: boolean } | { kind: 'update'; patch: Row } | { kind: 'delete' };

/** Just enough of the PostgREST query builder for communityService and authService. */
class Query {
  private op: Op = { kind: 'select', columns: '*', head: false };
  private preds: Pred[] = [];
  private embedFilters = new Map<string, unknown>();
  private orders: [string, boolean][] = [];
  private max: number | undefined;
  private singleMode: 'one' | 'maybe' | undefined;
  private returning: string | undefined;

  constructor(
    private readonly backend: FakeBackend,
    private readonly table: Table,
    private readonly record: (table: string, op: LoggedCall['op']) => void,
  ) {}

  select(columns = '*', opts: { head?: boolean } = {}) {
    if (this.op.kind === 'select') this.op = { kind: 'select', columns, head: !!opts.head };
    else this.returning = columns;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = { kind: 'insert', rows: Array.isArray(rows) ? rows : [rows], upsert: false, ignoreDuplicates: false };
    return this;
  }
  upsert(rows: Row | Row[], opts: { ignoreDuplicates?: boolean } = {}) {
    this.op = { kind: 'insert', rows: Array.isArray(rows) ? rows : [rows], upsert: true, ignoreDuplicates: !!opts.ignoreDuplicates };
    return this;
  }
  update(patch: Row) {
    this.op = { kind: 'update', patch };
    return this;
  }
  delete() {
    this.op = { kind: 'delete' };
    return this;
  }
  eq(col: string, value: unknown) {
    if (col.includes('.')) this.embedFilters.set(col, value);
    else this.preds.push((r) => r[col] === value);
    return this;
  }
  neq(col: string, value: unknown) {
    this.preds.push((r) => r[col] !== value);
    return this;
  }
  in(col: string, values: unknown[]) {
    this.preds.push((r) => values.includes(r[col]));
    return this;
  }
  ilike(col: string, pattern: string) {
    const re = new RegExp(`^${pattern.replace(/\\([\\%_])|([%_])|([.*+?^${}()|[\]])/g, (_m, esc, wild, special) => (esc ? `\\${esc}` : wild ? (wild === '%' ? '.*' : '.') : `\\${special}`))}$`, 'i');
    this.preds.push((r) => re.test(String(r[col] ?? '')));
    return this;
  }
  or(expr: string) {
    this.preds.push(parseLogic(expr, 'or'));
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orders.push([col, opts.ascending !== false]);
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.singleMode = 'maybe';
    return this;
  }
  single() {
    this.singleMode = 'one';
    return this;
  }

  run(): Result {
    const where: Pred = (r) => this.preds.every((p) => p(r));
    const b = this.backend;
    switch (this.op.kind) {
      case 'insert':
        this.record(this.table, this.op.upsert ? 'upsert' : 'insert');
        return b.insert(this.table, this.op.rows, { upsert: this.op.upsert, ignoreDuplicates: this.op.ignoreDuplicates });
      case 'update': {
        this.record(this.table, 'update');
        const rows = b.update(this.table, this.op.patch, where);
        if (this.returning === undefined) return { data: null, error: null, status: 204 };
        return this.finish(rows.map((r) => ({ ...r })));
      }
      case 'delete':
        this.record(this.table, 'delete');
        b.delete(this.table, where);
        return { data: null, error: null, status: 204 };
      case 'select': {
        this.record(this.table, 'select');
        const rows = b.select(this.table, this.op.columns, where, this.embedFilters);
        if (this.op.head) return { data: null, error: null, status: 200, count: rows.length };
        return this.finish(rows);
      }
    }
  }

  private finish(rows: Row[]): Result {
    const sorted = [...rows].sort((a, z) => {
      for (const [col, asc] of this.orders) {
        const x = String(a[col] ?? '');
        const y = String(z[col] ?? '');
        if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1);
      }
      return 0;
    });
    const limited = this.max === undefined ? sorted : sorted.slice(0, this.max);
    if (this.singleMode === 'maybe') return { data: limited[0] ?? null, error: null, status: 200 };
    if (this.singleMode === 'one') return limited.length === 1 ? { data: limited[0], error: null, status: 200 } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, status: 406 };
    return { data: limited, error: null, status: 200 };
  }

  then<T>(onOk: (r: Result) => T, onErr?: (e: unknown) => T): Promise<T> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onOk, onErr);
  }
}

// ── PostgREST logic trees: "a.eq.1,and(b.lt.2,c.in.(x,y))" ─────────────────

function splitTop(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = '';
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '(') depth++;
    if (!quoted && ch === ')') depth--;
    if (!quoted && depth === 0 && ch === ',') {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

function parseLogic(expr: string, mode: 'and' | 'or'): Pred {
  const preds = splitTop(expr).map((part): Pred => {
    const group = /^(and|or)\((.*)\)$/.exec(part);
    if (group) return parseLogic(group[2], group[1] as 'and' | 'or');
    const [col, op, ...rest] = part.split('.');
    const raw = rest.join('.');
    const value = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    switch (op) {
      case 'eq':
        return (r) => String(r[col]) === value;
      case 'lt':
        return (r) => String(r[col]) < value;
      case 'gt':
        return (r) => String(r[col]) > value;
      case 'in': {
        const list = value.replace(/^\(|\)$/g, '').split(',');
        return (r) => list.includes(String(r[col]));
      }
      default:
        throw new Error(`fakeBackend: unsupported filter ${part}`);
    }
  });
  return mode === 'and' ? (r) => preds.every((p) => p(r)) : (r) => preds.some((p) => p(r));
}
