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
  sbquo: '\u201a',
  bdquo: '\u201e',
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
  dagger: '\u2020',
  Dagger: '\u2021',
  permil: '\u2030',
  prime: '\u2032',
  Prime: '\u2033',
  lsaquo: '\u2039',
  rsaquo: '\u203a',
  minus: '\u2212',
  infin: '\u221e',
  ne: '\u2260',
  le: '\u2264',
  ge: '\u2265',
  lowast: '\u2217',
  weierp: '\u2118',
  real: '\u211c',
  part: '\u2202',
  nabla: '\u2207',
  sum: '\u2211',
  prod: '\u220f',
  radic: '\u221a',
  prop: '\u221d',
  ang: '\u2220',
  and: '\u2227',
  or: '\u2228',
  cap: '\u2229',
  cup: '\u222a',
  int: '\u222b',
  sim: '\u223c',
  cong: '\u2245',
  asymp: '\u2248',
  equiv: '\u2261',
  fnof: '\u0192',
  alpha: '\u03b1',
  beta: '\u03b2',
  gamma: '\u03b3',
  delta: '\u03b4',
  epsilon: '\u03b5',
  zeta: '\u03b6',
  eta: '\u03b7',
  theta: '\u03b8',
  iota: '\u03b9',
  kappa: '\u03ba',
  lambda: '\u03bb',
  mu: '\u03bc',
  nu: '\u03bd',
  xi: '\u03be',
  omicron: '\u03bf',
  pi: '\u03c0',
  rho: '\u03c1',
  sigma: '\u03c3',
  tau: '\u03c4',
  upsilon: '\u03c5',
  phi: '\u03c6',
  chi: '\u03c7',
  psi: '\u03c8',
  omega: '\u03c9',
  Alpha: '\u0391',
  Beta: '\u0392',
  Gamma: '\u0393',
  Delta: '\u0394',
  Epsilon: '\u0395',
  Zeta: '\u0396',
  Eta: '\u0397',
  Theta: '\u0398',
  Iota: '\u0399',
  Kappa: '\u039a',
  Lambda: '\u039b',
  Mu: '\u039c',
  Nu: '\u039d',
  Xi: '\u039e',
  Omicron: '\u039f',
  Pi: '\u03a0',
  Rho: '\u03a1',
  Sigma: '\u03a3',
  Tau: '\u03a4',
  Upsilon: '\u03a5',
  Phi: '\u03a6',
  Chi: '\u03a7',
  Psi: '\u03a8',
  Omega: '\u03a9',
  spades: '\u2660',
  clubs: '\u2663',
  hearts: '\u2665',
  diams: '\u2666',
  larr: '\u2190',
  uarr: '\u2191',
  rarr: '\u2192',
  darr: '\u2193',
  harr: '\u2194',
  crarr: '\u21b5',
  lArr: '\u21d0',
  uArr: '\u21d1',
  rArr: '\u21d2',
  dArr: '\u21d3',
  hArr: '\u21d4',
  enspace: '\u2002',
  emspace: '\u2003',
  thinsp: '\u2009',
  zwnj: '\u200c',
  zwj: '\u200d',
  lrm: '\u200e',
  rlm: '\u200f',
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
    !(code >= 0xd800 && code <= 0xdfff) &&
    // Reject Unicode noncharacters (last 2 codepoints of each plane + a few
    // dedicated ones) — they have no assigned glyph and would garble output.
    !isNoncharacter(code)
  ) {
    return String.fromCodePoint(code);
  }
  return '\ufffd';
}

function isNoncharacter(code: number): boolean {
  // Last two code points of each of the 17 planes (0xXXFE / 0xXXFF).
  if ((code & 0xfffe) === 0xfffe) return true;
  // Dedicated noncharacter ranges.
  return (
    (code >= 0xfdd0 && code <= 0xfdef) ||
    code === 0xfffe ||
    code === 0xffff ||
    code === 0x1fffe ||
    code === 0x1ffff ||
    code === 0x2fffe ||
    code === 0x2ffff ||
    code === 0x3fffe ||
    code === 0x3ffff ||
    code === 0x4fffe ||
    code === 0x4ffff ||
    code === 0x5fffe ||
    code === 0x5ffff ||
    code === 0x6fffe ||
    code === 0x6ffff ||
    code === 0x7fffe ||
    code === 0x7ffff ||
    code === 0x8fffe ||
    code === 0x8ffff ||
    code === 0x9fffe ||
    code === 0x9ffff ||
    code === 0xafffe ||
    code === 0xaffff ||
    code === 0xbfffe ||
    code === 0xbffff ||
    code === 0xcfffe ||
    code === 0xcffff ||
    code === 0xdfffe ||
    code === 0xdffff ||
    code === 0xefffe ||
    code === 0xeffff ||
    code === 0x10fffe ||
    code === 0x10ffff
  );
}

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|blockquote|h[1-6]|li)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<\/?(p|div|blockquote|h[1-6]|ul|ol|hr|tr|table)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

export function truncate(input: string, maxLength: number, suffix = '...'): string {
  if (input.length <= maxLength) return input;
  if (maxLength <= suffix.length) return suffix.slice(0, maxLength);
  return input.slice(0, maxLength - suffix.length) + suffix;
}

// East Asian Wide / Fullwidth characters that occupy 2 terminal columns.
// Based on Unicode East Asian Width property W and F, covering the ranges
// that the original implementation missed.
// See https://www.unicode.org/reports/tr11/ and
// https://www.unicode.org/Public/UCD/latest/ucd/EastAsianWidth.txt
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2329, 0x232a], // Angular brackets
  [0x2e80, 0x303e], // CJK Radicals, Kangxi
  [0x3041, 0x33ff], // Hiragana, Katakana, CJK symbols
  [0x3400, 0x4dbf], // CJK Ext A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi Syllables + Radicals
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe19], // Vertical forms
  [0xfe30, 0xfe4f], // CJK Compatibility Forms
  [0xff00, 0xff60], // Fullwidth ASCII
  [0xffe0, 0xffe6], // Fullwidth currency/signs
  [0x1f300, 0x1f64f], // Emoji — pictographs
  [0x1f900, 0x1f9ff], // Supplemental symbols and pictographs
  [0x20000, 0x2fffd], // CJK Ext B
  [0x30000, 0x3fffd], // CJK Ext C-G
  // Ambiguous-width ranges treated as wide in a CJK context are not
  // included; in a Latin terminal they render single-width.
  [0x1b000, 0x1b0ff], // Kana Supplement
  [0x1f000, 0x1f02f], // Mahjong tiles
  [0x1f0a0, 0x1f0ff], // Playing cards, dominoes
  [0x1f100, 0x1f1ff], // Enclosed alphanumerics + regional indicators (flags)
  [0x2800, 0x28ff], // Braille Patterns (W in East Asian Width)
  [0xa8e0, 0xa8ff], // Devanagari Extended (combining, display as wide)
  [0x1a20, 0x1aad], // Tai Tham
  [0x1b00, 0x1b7f], // Balinese
  [0xa490, 0xa4c6], // Yi Radicals (partially, end of Yi block above covers rest)
];

export function displayWidth(input: string): number {
  let width = 0;
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    let isWide = false;
    for (const [lo, hi] of WIDE_RANGES) {
      if (code >= lo && code <= hi) {
        isWide = true;
        break;
      }
    }
    width += isWide ? 2 : 1;
  }
  return width;
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

// Truncate text to fit a display width, appending an ellipsis when truncated.
// Width-aware (uses displayWidth) so CJK / wide glyphs count as 2 columns.
export function truncateW(text: string, max: number): string {
  if (displayWidth(text) <= max) return text;
  let out = '';
  let w = 0;
  for (const ch of text) {
    const cw = displayWidth(ch);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
}

// Split a string into Unicode code points rather than UTF-16 code units, so
// surrogate pairs (CJK, emoji) survive intact. input.split('') would tear a
// pair like 😀 into two lone surrogates and produce garbage keypresses.
export function splitChars(input: string): string[] {
  return Array.from(input);
}

// Format a SQLite UTC timestamp ("YYYY-MM-DD HH:MM:SS" from datetime('now'))
// in the given IANA time zone (default: the local one), e.g. for the book
// info card. Invalid/empty input is returned unchanged.
export function formatLocalTimestamp(
  utcSql: string,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(utcSql);
  if (!m) return utcSql;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)),
  );
  if (Number.isNaN(date.getTime())) return utcSql;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}
