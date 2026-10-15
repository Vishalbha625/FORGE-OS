// The two bits of markdown the coach uses: **bold** and "- " bullet lines.
// Parsed into plain data (no HTML strings), so rendering can't inject markup.

export type Inline = { text: string; bold: boolean };
export type MdBlock = { type: 'paragraph'; lines: Inline[][] } | { type: 'list'; items: Inline[][] };

/** Split a line into plain and **bold** runs. An unclosed ** stays as text. */
export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last), bold: false });
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;

/** Blank lines separate paragraphs; consecutive bullet lines form one list. */
export function parseSimpleMarkdown(text: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const last = blocks[blocks.length - 1];
    const bullet = BULLET.exec(line);
    if (bullet) {
      if (last?.type === 'list') last.items.push(parseInline(bullet[1]));
      else blocks.push({ type: 'list', items: [parseInline(bullet[1])] });
    } else if (!line.trim()) {
      blocks.push({ type: 'paragraph', lines: [] }); // marks a break; empty ones are dropped below
    } else if (last?.type === 'paragraph' && last.lines.length) {
      last.lines.push(parseInline(line));
    } else {
      blocks.push({ type: 'paragraph', lines: [parseInline(line)] });
    }
  }
  return blocks.filter((b) => (b.type === 'list' ? b.items.length > 0 : b.lines.length > 0));
}
