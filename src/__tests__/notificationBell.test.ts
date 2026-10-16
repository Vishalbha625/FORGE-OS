import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { NotificationBellView, badgeText } from '../features/notifications/NotificationBell';

const render = (count: number) => renderToStaticMarkup(createElement(StaticRouter, { location: '/' }, createElement(NotificationBellView, { count })));

describe('NotificationBell', () => {
  it('shows the unread count on the badge and in the label', () => {
    const html = render(3);
    expect(html).toContain('aria-label="Notifications, 3 unread"');
    expect(html).toMatch(/>3<\/span>/);
    expect(html).toContain('href="/notifications"');
    expect(badgeText(12)).toBe('9+');
    expect(render(12)).toMatch(/>9\+<\/span>/);
  });

  it('hides the badge when nothing is unread', () => {
    const html = render(0);
    expect(html).toContain('aria-label="Notifications"');
    expect(html).not.toContain('<span');
    expect(badgeText(0)).toBeNull();
  });
});
