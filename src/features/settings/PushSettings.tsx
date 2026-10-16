import { Link } from 'react-router-dom';
import { BellRing, Check } from 'lucide-react';
import { Card, SectionTitle, Toggle } from '../../components/ui';
import { useToast } from '../../store/toast';
import { PUSH_CATEGORIES, categoryOn } from '../../lib/pushService';
import { usePushControls } from './usePushControls';

/** Profile > Notifications: push on this device, per category. */
export function PushSettings() {
  const toast = useToast();
  const { state, busy, enable, disable, setCategory, push } = usePushControls();

  const turnOn = async () => {
    const res = await enable();
    toast(res.success ? 'Notifications are on' : res.error ?? 'Could not turn on notifications.');
  };

  return (
    <>
      <SectionTitle lead="Reminders and community updates, even when Forge OS is closed. A notification never contains your health data.">Notifications</SectionTitle>
      <Card className="mb-3">
        {state === 'unsupported' && <p className="text-sm text-muted">Push notifications are not supported in this browser. On iPhone, add Forge OS to your home screen first.</p>}
        {state === 'signed_out' && (
          <p className="text-sm text-muted">
            Notifications are tied to your community account. <Link to="/login" state={{ from: '/profile' }} className="link">Sign in</Link> to turn them on for this device.
          </p>
        )}
        {state === 'checking' && <p className="text-sm text-muted motion-safe:animate-pulse" role="status">Checking the notification server</p>}
        {state === 'unavailable' && <p className="text-sm text-muted">Notifications aren't set up on the server yet. Reminders still show while the app is open.</p>}
        {state === 'denied' && <p className="text-sm text-muted">Notifications are blocked. Open your browser's settings for this site to allow them.</p>}
        {state === 'off' && (
          <div className="space-y-3">
            <p className="text-sm text-muted">Enable notifications to get reminders and social updates.</p>
            <button className="btn-soft w-full" onClick={turnOn} disabled={busy}>
              <BellRing className="h-4 w-4" aria-hidden /> {busy ? 'Turning on…' : 'Enable notifications'}
            </button>
          </div>
        )}
        {state === 'on' && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm font-medium text-good">
                <Check className="h-4 w-4" aria-hidden /> Notifications are on
              </span>
              <button className="link text-sm" onClick={() => void disable()} disabled={busy}>Disable all</button>
            </div>
            <ul className="divide-y divide-border">
              {PUSH_CATEGORIES.map((c) => (
                <li key={c.key} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm">{c.label}</span>
                  <Toggle on={categoryOn(push, c.key)} label={`${c.label} notifications`} onClick={() => void setCategory(c.key, !categoryOn(push, c.key))} />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">Reminder notifications follow the reminders you switch on above. The server keeps them in memory, so after a server restart they return the next time you open the app.</p>
          </div>
        )}
      </Card>
    </>
  );
}
