import { useCallback } from 'react';
import { useAuth } from '../../store/AuthContext';
import { usePushApi } from '../../hooks/usePushApi';
import { createNotification, type NotificationType } from '../../lib/notificationService';
import { markSocialAction } from '../settings/PushSoftAsk';

/**
 * Tells the other person about something you just did: a notification in
 * their inbox, and a push (createNotification sends it). Call it only after
 * the action itself succeeded; it never throws and never blocks. Nothing goes
 * out for your own posts, and the database refuses duplicates and blocks. The
 * recipient's own settings (on the server) decide whether a push is shown.
 */
export function useSocialNotify() {
  const { user } = useAuth();
  const api = usePushApi();
  const me = user?.id;
  return useCallback(
    (type: NotificationType, recipientId: string, postId?: string, commentId?: string) => {
      markSocialAction(); // the community banner offers notifications after this
      if (!me || recipientId === me) return;
      createNotification(type, me, recipientId, postId, commentId, api).then(
        (res) => res.error && console.warn('Notification not sent.', res.error),
        (err) => console.warn('Notification not sent.', err),
      );
    },
    [api, me],
  );
}
