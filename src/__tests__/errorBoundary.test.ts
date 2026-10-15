import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorBoundary } from '../components/ErrorBoundary';

// Server rendering has no error boundaries, so the fallback is checked by
// putting the boundary into its error state the way React does.

describe('ErrorBoundary', () => {
  it('renders its children when nothing is wrong', () => {
    const html = renderToStaticMarkup(createElement(ErrorBoundary, { section: 'analytics', children: createElement('p', null, 'Charts') }));
    expect(html).toBe('<p>Charts</p>');
  });

  it('shows the fallback with a reload button after an error, and logs it', () => {
    const error = new Error('chart blew up');
    const state = ErrorBoundary.getDerivedStateFromError(error);
    expect(state.error).toBe(error);

    const boundary = new ErrorBoundary({ section: 'analytics', children: createElement('p', null, 'Charts') });
    boundary.state = state;
    const html = renderToStaticMarkup(boundary.render() as ReactElement);
    expect(html).toContain('Something went wrong');
    expect(html).toContain('Reload');
    expect(html).not.toContain('Charts');
    // Vitest runs in development mode, so the message is shown.
    expect(html).toContain('chart blew up');

    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    boundary.componentDidCatch(error, { componentStack: '\n    at Chart' });
    expect(log).toHaveBeenCalledWith('Forge OS: analytics crashed.', error, '\n    at Chart');
    log.mockRestore();
  });
});
