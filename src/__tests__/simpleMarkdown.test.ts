import { describe, it, expect } from 'vitest';
import { parseInline, parseSimpleMarkdown } from '../lib/simpleMarkdown';

describe('simple markdown', () => {
  it('splits **bold** runs and leaves an unclosed marker as text', () => {
    expect(parseInline('You ran **12.5 km** this week')).toEqual([
      { text: 'You ran ', bold: false }, { text: '12.5 km', bold: true }, { text: ' this week', bold: false },
    ]);
    expect(parseInline('5 ** 2')).toEqual([{ text: '5 ** 2', bold: false }]);
  });

  it('groups bullet lines into one list and keeps paragraphs apart', () => {
    const blocks = parseSimpleMarkdown('Good week.\nKeep it up.\n\n- Sleep **7.5 h**\n- Protein 120 g\n\nNext: rest.');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'list', 'paragraph']);
    expect(blocks[0]).toMatchObject({ type: 'paragraph', lines: [[{ text: 'Good week.' }], [{ text: 'Keep it up.' }]] });
    expect(blocks[1]).toEqual({ type: 'list', items: [[{ text: 'Sleep ', bold: false }, { text: '7.5 h', bold: true }], [{ text: 'Protein 120 g', bold: false }]] });
  });

  it('treats HTML as plain text (rendered as text, never markup)', () => {
    expect(parseSimpleMarkdown('<img src=x onerror=alert(1)>')).toEqual([{ type: 'paragraph', lines: [[{ text: '<img src=x onerror=alert(1)>', bold: false }]] }]);
  });
});
