// Cleans community text before it is stored or shown. React already escapes
// text on render; this is defence in depth for other readers of the data.

export interface SanitizeOptions {
  maxLength: number;
  /** Collapse newlines and runs of spaces (for names and titles). */
  singleLine?: boolean;
}

const BLOCK_WITH_CONTENT = /<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const TAG = /<\/?[a-z!][^>]*>/gi;
const EVENT_HANDLER = /\bon[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi;
const SCRIPT_URI = /\b(?:javascript|vbscript)\s*:/gi;
// Only real data URIs (data:<type>/<subtype>), so "Training data: 5 km" survives.
const DATA_URI = /\bdata\s*:\s*[a-z]+\/[a-z0-9.+-]+[;,]\S*/gi;
// Control characters except tab and newline.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

export function sanitizeText(input: unknown, options: SanitizeOptions): string {
  if (typeof input !== 'string') return '';
  let text = input
    .replace(BLOCK_WITH_CONTENT, '')
    .replace(TAG, '')
    .replace(EVENT_HANDLER, '')
    .replace(SCRIPT_URI, '')
    .replace(DATA_URI, '')
    .replace(CONTROL, '');
  text = options.singleLine ? text.replace(/\s+/g, ' ') : text.replace(/\r\n?/g, '\n');
  text = text.trim();
  // Cut by characters, not UTF-16 units, so an emoji is never split in half.
  const chars = Array.from(text);
  return chars.length > options.maxLength ? chars.slice(0, options.maxLength).join('').trimEnd() : text;
}

export const sanitizeDisplayName = (input: unknown) => sanitizeText(input, { maxLength: 60, singleLine: true });
export const sanitizeBio = (input: unknown) => sanitizeText(input, { maxLength: 300 });
export const sanitizePostTitle = (input: unknown) => sanitizeText(input, { maxLength: 120, singleLine: true });
export const sanitizeCaption = (input: unknown) => sanitizeText(input, { maxLength: 2000 });
export const sanitizeComment = (input: unknown) => sanitizeText(input, { maxLength: 1000 });
