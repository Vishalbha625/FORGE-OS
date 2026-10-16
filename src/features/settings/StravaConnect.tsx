import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Check, RefreshCw } from 'lucide-react';
import { Card, SectionTitle } from '../../components/ui';
import { useApp } from '../../store/AppContext';
import { useConfirm } from '../../store/confirm';
import { useToast } from '../../store/toast';
import { usePushApi } from '../../hooks/usePushApi';
import { connectStrava, disconnectStrava, syncActivities, syncSummary } from '../../lib/stravaService';
import { getRelativeTime } from '../../lib/relativeTime';

/** "Just now" and "Yesterday" read better mid-sentence in lower case; dates stay as they are. */
const inline = (rel: string) => (rel === 'Just now' || rel === 'Yesterday' ? rel.toLowerCase() : rel);

/** Profile > Strava: connect, sync now, disconnect. The tokens stay on the coach server. */
export function StravaConnect() {
  const { settings, reload } = useApp();
  const api = usePushApi();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<'connect' | 'sync' | 'disconnect' | null>(null);
  const strava = settings?.strava;

  const connect = async () => {
    if (!api) return;
    setBusy('connect');
    const res = await connectStrava(api);
    // On success the browser is on its way to Strava; only an error comes back here.
    if (res.error) {
      setBusy(null);
      toast(res.error);
    }
  };

  const sync = async () => {
    if (!api) return;
    setBusy('sync');
    const res = await syncActivities(api);
    await reload();
    setBusy(null);
    toast(res.error ?? syncSummary(res));
  };

  const disconnect = async () => {
    if (!api) return;
    const ok = await confirm({
      title: 'Disconnect Strava?',
      description: 'Forge OS stops importing from Strava and the server deletes its access. Activities already imported stay in your logs.',
      confirmLabel: 'Disconnect',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy('disconnect');
    const res = await disconnectStrava(api);
    await reload();
    setBusy(null);
    toast(res.error ?? 'Strava disconnected');
  };

  return (
    <>
      <SectionTitle lead="Import your runs automatically. Your data stays on this device.">Strava</SectionTitle>
      <Card className="mb-3">
        {!api ? (
          <p className="text-sm text-muted">
            Strava import uses your community account. <Link to="/login" state={{ from: '/profile' }} className="link">Sign in</Link> to connect.
          </p>
        ) : strava?.connected ? (
          <div className="space-y-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-good">
                <Check className="h-4 w-4" aria-hidden /> Connected{strava.athleteName ? ` as ${strava.athleteName}` : ''}
              </p>
              <p className="mt-1 text-xs text-muted">{strava.lastSyncAt ? `Last synced ${inline(getRelativeTime(strava.lastSyncAt))}` : 'Not synced yet'}</p>
            </div>
            <button className="btn-soft w-full" onClick={() => void sync()} disabled={busy !== null}>
              <RefreshCw className={`h-4 w-4 ${busy === 'sync' ? 'motion-safe:animate-spin' : ''}`} aria-hidden /> {busy === 'sync' ? 'Syncing…' : 'Sync now'}
            </button>
            <p className="text-xs text-muted">
              Runs, strength and Crossfit sessions are imported. Rides, walks and other types are left out. Previously imported activities stay in your logs.
            </p>
            <button className="link text-sm" onClick={() => void disconnect()} disabled={busy !== null}>Disconnect</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">Runs come in with distance, time, pace, heart rate and climb. Maps and GPS tracks are never imported.</p>
            <button className="btn-soft w-full" onClick={() => void connect()} disabled={busy !== null}>
              <Activity className="h-4 w-4" aria-hidden /> {busy === 'connect' ? 'Opening Strava…' : 'Connect Strava'}
            </button>
          </div>
        )}
      </Card>
    </>
  );
}
