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

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  laquo: '\u00ab',
  raquo: '\u00bb',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  bull: '\u2022',
  middot: '\u00b7',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  deg: '\u00b0',
  plusmn: '\u00b1',
  euro: '\u20ac',
  pound: '\u00a3',
  yen: '\u00a5',
  sect: '\u00a7',
  para: '\u00b6',
  times: '\u00d7',
  divide: '\u00f7',
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]{0,31});/g, (_m, name: string) => {
      const decoded = NAMED_ENTITIES[name];
      return decoded !== undefined ? decoded : _m;
    });
}

function safeCodePoint(code: number): string {
  if (
    Number.isInteger(code) &&
    code >= 0 &&
    code <= 0x10ffff &&
    !(code >= 0xd800 && code <= 0xdfff)
  ) {
    return String.fromCodePoint(code);
  }
  return '\ufffd';
}

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function truncate(input: string, maxLength: number, suffix = '...'): string {
  if (input.length <= maxLength) return input;
  if (maxLength <= suffix.length) return suffix.slice(0, maxLength);
  return input.slice(0, maxLength - suffix.length) + suffix;
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

export function shellSplit(input: string): string[] {
  const result: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current !== '') {
        result.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current !== '') result.push(current);
  return result;
}
