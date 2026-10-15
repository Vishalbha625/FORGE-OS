import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Search } from 'lucide-react';
import { useAuth } from '../../store/AuthContext';
import { searchProfiles, type CommunityProfile } from '../../lib/communityService';
import { ProfileRow } from './shared';

const DEBOUNCE_MS = 300;

export function SearchUsersPage() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CommunityProfile[]>([]);
  const [searched, setSearched] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  // Search 300 ms after typing stops; a slower earlier answer never replaces a newer one.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearched('');
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    const ticket = ++latest.current;
    const timer = window.setTimeout(async () => {
      const res = await searchProfiles(q, me);
      if (ticket !== latest.current) return;
      setLoading(false);
      setSearched(q);
      setError(res.error);
      setResults(res.data ?? []);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, me]);

  return (
    <div className="pb-8">
      <Link to="/community" className="link mb-3 mt-3 inline-flex items-center gap-1.5">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to the feed
      </Link>
      <h1 className="mb-3 text-xl font-medium tracking-tight">Find athletes</h1>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <input className="field pl-9" type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name" aria-label="Search athletes by name" maxLength={60} />
        {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted motion-safe:animate-spin" aria-label="Searching" />}
      </div>

      <div className="mt-4" aria-live="polite">
        {!query.trim() ? (
          <p className="py-6 text-center text-sm text-muted">Search for athletes by name</p>
        ) : error ? (
          <p className="py-6 text-center text-sm text-muted">{error}</p>
        ) : searched && !loading && results.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No athletes found matching '{searched}'.</p>
        ) : (
          <ul className="divide-y divide-border">{results.map((p) => <ProfileRow key={p.id} profile={p} />)}</ul>
        )}
      </div>
    </div>
  );
}
