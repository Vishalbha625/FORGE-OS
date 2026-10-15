import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SkeletonAvatar, SkeletonCard, SkeletonChart, SkeletonLine } from '../components/Skeleton';

describe('Skeleton', () => {
  it('SkeletonCard pulses in the warm stone colours', () => {
    const html = renderToStaticMarkup(createElement(SkeletonCard));
    expect(html).toContain('animate-pulse');
    expect(html).toContain('bg-stone-200');
    expect(html).toContain('dark:bg-stone-700');
    expect(html).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(createElement(SkeletonChart))).toContain('h-[200px]');
  });

  it('SkeletonLine takes a width class and SkeletonAvatar a size', () => {
    expect(renderToStaticMarkup(createElement(SkeletonLine, { width: 'w-1/2' }))).toContain('w-1/2');
    expect(renderToStaticMarkup(createElement(SkeletonLine))).toContain('w-full');
    expect(renderToStaticMarkup(createElement(SkeletonAvatar, { size: 'lg' }))).toContain('h-16 w-16');
  });
});
