import { useState } from 'react';
import { BellRing } from 'lucide-react';
import { useToast } from '../../store/toast';
import { SOFT_ASK_DENIED_KEY, SOFT_ASK_DISMISSED_KEY, pushStorage, usePushControls } from './usePushControls';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Set after the first kudos, comment or follow on this device. */
export const SOCIAL_ACTED_KEY = 'push_softask_social';

export const markSocialAction = () => pushStorage.set(SOCIAL_ACTED_KEY, '1');

const COPY = {
  reminders: { title: 'Get reminders to stay on track?', body: 'Workout, meal and weigh-in reminders, even when the app is closed.' },
  social: { title: 'Get notified when people interact?', body: 'Know when someone gives kudos, comments or wants to follow you.' },
} as const;

/** Was the banner dismissed within the last week, or did the browser say no? */
export function softAskHidden(now: number = Date.now()): boolean {
  if (pushStorage.get(SOFT_ASK_DENIED_KEY)) return true;
  const at = Number(pushStorage.get(SOFT_ASK_DISMISSED_KEY));
  return Number.isFinite(at) && at > 0 && now - at < WEEK_MS;
}

/**
 * An in-app invitation, never the browser prompt: that only appears after the
 * athlete taps Enable. Shown only when push could actually be turned on.
 */
export function PushSoftAsk({ variant }: { variant: keyof typeof COPY }) {
  const toast = useToast();
  const { state, busy, enable } = usePushControls();
  const [hidden, setHidden] = useState(softAskHidden);
  const needsSocial = variant === 'social' && !pushStorage.get(SOCIAL_ACTED_KEY);
  if (hidden || needsSocial || state !== 'off' || (typeof Notification !== 'undefined' && Notification.permission !== 'default')) return null;

  const notNow = () => {
    pushStorage.set(SOFT_ASK_DISMISSED_KEY, String(Date.now()));
    setHidden(true);
  };
  const yes = async () => {
    const res = await enable();
    setHidden(true);
    toast(res.success ? 'Notifications are on' : res.error ?? 'Could not turn on notifications.');
  };

  return (
    <section aria-label="Turn on notifications" className="card mb-4 border-[color:var(--card-edge-hover)] p-4">
      <div className="flex gap-3">
        <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-highlight" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{COPY[variant].title}</p>
          <p className="mt-0.5 text-sm text-muted">{COPY[variant].body}</p>
          <div className="mt-3 flex items-center gap-4">
            <button className="btn-soft" onClick={yes} disabled={busy}>{busy ? 'Turning on…' : 'Enable'}</button>
            <button className="link text-sm" onClick={notNow}>Not now</button>
          </div>
        </div>
      </div>
    </section>
  );
}
