import { useCallback } from 'react';
import { useAuth } from '../../store/AuthContext';
import { usePushApi } from '../../hooks/usePushApi';
import { sendPushToUser, type SocialPushType } from '../../lib/pushService';
import { markSocialAction } from '../settings/PushSoftAsk';

/**
 * Tells the other person about something you just did. Call it only after the
 * action itself succeeded; it never throws and never blocks. Nothing goes out
 * for your own posts. The recipient's own settings (on the server) decide
 * whether a push is shown.
 */
export function useSocialNotify() {
  const { user } = useAuth();
  const api = usePushApi();
  const me = user?.id;
  return useCallback(
    (type: SocialPushType, recipientId: string, postId?: string) => {
      markSocialAction(); // the community banner offers notifications after this
      if (!api || !me || recipientId === me) return;
      void sendPushToUser(api, me, recipientId, type, postId);
    },
    [api, me],
  );
}
