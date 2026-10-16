import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../../store/AppContext';
import { useToast } from '../../store/toast';
import { usePushApi } from '../../hooks/usePushApi';
import { exchangeStravaCode } from '../../lib/stravaService';
import { SkeletonLine } from '../../components/Skeleton';

/** Strava sends the athlete back here with a one-time code; the server swaps it for tokens. */
export function StravaCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { reload } = useApp();
  const api = usePushApi();
  const started = useRef(false); // the code works once: never send it twice

  useEffect(() => {
    if (!api || started.current) return;
    started.current = true;
    const done = (msg: string) => {
      toast(msg);
      navigate('/profile', { replace: true });
    };
    const code = params.get('code');
    const state = params.get('state');
    if (params.get('error') || !code || !state) return done('Strava was not connected.');
    void exchangeStravaCode(api, code, state, params.get('scope') ?? undefined).then(async (res) => {
      if (!res.connected) return done(res.error ?? 'Strava was not connected.');
      await reload();
      done('Strava connected. Tap Sync now to import.');
    });
  }, [api, params, navigate, toast, reload]);

  return (
    <div className="mx-auto mt-16 max-w-xs space-y-3" role="status" aria-label="Connecting Strava">
      <p className="text-center text-sm text-muted">Connecting Strava</p>
      <SkeletonLine />
      <SkeletonLine width="w-2/3" className="mx-auto" />
    </div>
  );
}
