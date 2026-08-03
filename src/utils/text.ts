import type { Inline } from '../formats/model.js';

export function inlinesToText(inlines: Inline[] | undefined): string {
  if (!inlines) return '';
  let out = '';
  for (const inline of inlines) {
    out += inlineToText(inline);
  }
  return out;
}

function inlineToText(inline: Inline): string {
  switch (inline.kind) {
    case 'text':
      return inline.text;
    case 'bold':
    case 'italic':
    case 'underline':
    case 'strike':
    case 'link':
      return inlinesToText(inline.children);
    case 'code':
      return inline.text;
    case 'image':
      return inline.alt || '';
    case 'lineBreak':
      return '\n';
  }
}

export function stripTags(input: string): string {
  return input.replace(/<[^>]*>/g, '');
}

export function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)));
}

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function truncate(input: string, maxLength: number, suffix = '...'): string {
  if (input.length <= maxLength) return input;
  if (maxLength <= suffix.length) return suffix.slice(0, maxLength);
  return input.slice(0, maxLength - suffix.length) + suffix;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0]![j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }
  return matrix[a.length]![b.length]!;
}

export function ansiStrip(input: string): string {
  return input.replace(/\x1b\[[0-9;]*m/g, '');
}

export function displayWidth(input: string): number {
  let width = 0;
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x1100 && code <= 0x11ff) width += 2;
    else if (code >= 0x2e80 && code <= 0xa4cf) width += 2;
    else if (code >= 0xac00 && code <= 0xd7a3) width += 2;
    else if (code >= 0xf900 && code <= 0xfaff) width += 2;
    else if (code >= 0xfe30 && code <= 0xfe4f) width += 2;
    else if (code >= 0xff00 && code <= 0xff60) width += 2;
    else if (code >= 0xffe0 && code <= 0xffe6) width += 2;
    else if (code >= 0x20000 && code <= 0x2fffd) width += 2;
    else if (code >= 0x30000 && code <= 0x3fffd) width += 2;
    else width += 1;
  }
  return width;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
