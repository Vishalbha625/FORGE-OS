import { describe, it, expect } from 'vitest';
import { sanitizeText, sanitizeComment, sanitizeDisplayName, sanitizePostTitle } from '../lib/sanitize';

describe('sanitize', () => {
  it('strips HTML tags, scripts, event handlers and script URIs', () => {
    expect(sanitizeComment('<b>Great</b> run!<script>alert(1)</script>')).toBe('Great run!');
    expect(sanitizeComment('<img src=x onerror="alert(1)">nice')).toBe('nice');
    expect(sanitizeComment('see javascript:alert(1)')).toBe('see alert(1)');
    expect(sanitizeComment('pic data:text/html;base64,PHNjcmlwdD4= here')).toBe('pic  here');
    // Ordinary text that only looks similar is kept.
    expect(sanitizeComment('Training data: 5 km, pace < 5:00')).toBe('Training data: 5 km, pace < 5:00');
  });

  it('trims and enforces maxLength without splitting emoji', () => {
    expect(sanitizeText('  hello  ', { maxLength: 10 })).toBe('hello');
    expect(sanitizeText('abcdef', { maxLength: 3 })).toBe('abc');
    expect(sanitizeText('🔥🔥🔥', { maxLength: 2 })).toBe('🔥🔥');
    expect(Array.from(sanitizeDisplayName('x'.repeat(100)))).toHaveLength(60);
    expect(sanitizePostTitle('Long\n\nrun   today')).toBe('Long run today');
  });

  it('returns an empty string for non-string input', () => {
    expect(sanitizeComment(undefined)).toBe('');
    expect(sanitizeComment(null)).toBe('');
    expect(sanitizeComment(42)).toBe('');
    expect(sanitizeComment({ text: 'hi' })).toBe('');
  });
});
