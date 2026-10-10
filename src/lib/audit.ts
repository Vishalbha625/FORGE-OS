// Human-readable audit summaries. Kept pure so they can be unit-tested.

type AnyRec = Record<string, unknown>;

/** Drop large blobs (photos) from audit snapshots so history stays small. */
export function stripForAudit(rec: unknown): unknown {
  if (!rec || typeof rec !== 'object') return rec;
  const copy: AnyRec = { ...(rec as AnyRec) };
  if (typeof copy.photo === 'string') copy.photo = '[photo]';
  return copy;
}

export function auditSummary(store: string, rec: unknown, action: 'update' | 'delete'): string {
  const r = (rec ?? {}) as AnyRec;
  const verb = action === 'delete' ? 'Deleted' : 'Edited';
  const date = typeof r.eventDate === 'string' ? ` (${r.eventDate})` : '';
  switch (store) {
    case 'runs':
      return `${verb} ${r.kind ?? ''} run ${r.distanceKm ?? '?'} km${date}`;
    case 'strength':
    case 'hyrox':
      return `${verb} ${store === 'hyrox' ? 'HYROX' : 'strength'} session "${r.title ?? ''}"${date}`;
    case 'nutrition':
      return `${verb} ${r.meal ?? ''} entry "${r.name ?? ''}"${date}`;
    case 'water':
      return `${verb} water ${r.amountMl ?? '?'} ml${date}`;
    case 'sleep':
      return `${verb} sleep record${date}`;
    case 'steps':
      return `${verb} steps ${r.steps ?? '?'}${date}`;
    case 'body':
      return `${verb} body metrics${r.weightKg ? ` ${r.weightKg} kg` : ''}${date}`;
    case 'recovery':
      return `${verb} recovery log${date}`;
    case 'plannedWorkouts':
      return `${verb} planned session "${r.title ?? ''}"${date}`;
    default:
      return `${verb} ${store} record${date}`;
  }
}

/** Field-level diff between two snapshots (top-level keys only). */
export function diffKeys(before: unknown, after: unknown): string[] {
  const a = (before ?? {}) as AnyRec;
  const b = (after ?? {}) as AnyRec;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const ignore = new Set(['updatedAt', 'createdAt', 'id']);
  return [...keys].filter((k) => !ignore.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
