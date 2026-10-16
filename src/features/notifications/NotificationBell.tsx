import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useAuth } from '../../store/AuthContext';
import { useUnreadCount } from '../../hooks/useUnreadCount';

/** "9+" past nine, nothing at zero. */
export const badgeText = (count: number) => (count <= 0 ? null : count > 9 ? '9+' : String(count));

/** The bell itself, given a count. Neutral badge: ChaiUI keeps meaning colours to text and outlines. */
export function NotificationBellView({ count }: { count: number }) {
  const badge = badgeText(count);
  return (
    <Link
      to="/notifications"
      aria-label={badge ? `Notifications, ${count} unread` : 'Notifications'}
      className="relative grid h-9 w-9 place-items-center rounded-md text-foreground/80 transition-colors hover:text-foreground"
    >
      <Bell className="h-5 w-5" aria-hidden />
      {badge && (
        <span aria-hidden className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-foreground px-1 text-[10px] font-semibold leading-none text-background tabular-nums">
          {badge}
        </span>
      )}
    </Link>
  );
}

/** Shown only to signed-in members: notifications are a community feature. */
export function NotificationBell() {
  const { isAuthenticated } = useAuth();
  const { unreadCount } = useUnreadCount();
  if (!isAuthenticated) return null;
  return <NotificationBellView count={unreadCount} />;
}
