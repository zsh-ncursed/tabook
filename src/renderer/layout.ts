import type { Block, Inline } from '../formats/model.js';
import { displayWidth, inlinesToText } from '../utils/text.js';
import type { TypographyConfig } from '../config/defaults.js';
import { blockToPlainText } from './blocks.js';
import { IMAGE_ROWS } from '../tui/imageLayer.js';

export type LineRole =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'paragraph'
  | 'code'
  | 'listItem'
  | 'quote'
  | 'tableHeader'
  | 'tableCell'
  | 'poemLine'
  | 'epigraph'
  | 'annotation'
  | 'image'
  | 'empty';

export interface StyledSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  link?: boolean;
  highlight?: boolean;
}

export interface TextLine {
  role: LineRole;
  spans: StyledSpan[];
  indent: number;
  prefix: string;
  blockIndex: number;
  charOffset: number;
}

export interface HighlightRange {
  start: number;
  end: number;
}

export interface LayoutOptions {
  typo: TypographyConfig;
  width: number;
  getHighlights?: (blockIndex: number) => HighlightRange[] | undefined;
  justify?: boolean;
}

interface CharStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  link: boolean;
  highlight: boolean;
}

const EMPTY_STYLE: CharStyle = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  link: false,
  highlight: false,
};

interface Char {
  ch: string;
  style: CharStyle;
  offset: number;
}

function styleKey(s: CharStyle): string {
  return `${s.bold ? 1 : 0}${s.italic ? 1 : 0}${s.underline ? 1 : 0}${s.strike ? 1 : 0}${s.link ? 1 : 0}${s.highlight ? 1 : 0}`;
}

export function inlineToSpans(inlines: Inline[], style: CharStyle = EMPTY_STYLE): StyledSpan[] {
  const chars: Char[] = [];
  let offset = 0;
  const pushChars = (text: string, st: CharStyle): void => {
    for (const ch of text) {
      chars.push({ ch, style: { ...st }, offset });
      offset += 1;
    }
  };
  const walk = (nodes: Inline[], st: CharStyle): void => {
    for (const inline of nodes) {
      switch (inline.kind) {
        case 'text':
          pushChars(inline.text, st);
          break;
        case 'bold':
          walk(inline.children, { ...st, bold: true });
          break;
        case 'italic':
          walk(inline.children, { ...st, italic: true });
          break;
        case 'underline':
          walk(inline.children, { ...st, underline: true });
          break;
        case 'strike':
          walk(inline.children, { ...st, strike: true });
          break;
        case 'link':
          walk(inline.children, { ...st, link: true });
          break;
        case 'code':
          pushChars(inline.text, { ...st });
          break;
        case 'image':
          pushChars(inline.alt, { ...st });
          break;
        case 'lineBreak':
          pushChars(' ', { ...st });
          break;
      }
    }
  };
  walk(inlines, style);
  return charsToSpans(chars);
}

function charsToSpans(chars: Char[]): StyledSpan[] {
  const spans: StyledSpan[] = [];
  let current: StyledSpan | undefined;
  let currentKey = '';
  for (const char of chars) {
    const key = styleKey(char.style);
    if (current && currentKey === key) {
      current.text += char.ch;
    } else {
      current = {
        text: char.ch,
        bold: char.style.bold,
        italic: char.style.italic,
        underline: char.style.underline,
        strike: char.style.strike,
        link: char.style.link,
        highlight: char.style.highlight,
      };
      currentKey = key;
      spans.push(current);
    }
  }
  return spans;
}

export function applyHighlights(spans: StyledSpan[], highlights: HighlightRange[]): StyledSpan[] {
  if (highlights.length === 0) return spans;
  const chars: Char[] = [];
  let offset = 0;
  for (const span of spans) {
    for (const ch of span.text) {
      const inRange = highlights.some((h) => offset >= h.start && offset < h.end);
      chars.push({
        ch,
        style: {
          bold: !!span.bold,
          italic: !!span.italic,
          underline: !!span.underline,
          strike: !!span.strike,
          link: !!span.link,
          highlight: inRange || !!span.highlight,
        },
        offset,
      });
      offset += 1;
    }
  }
  return charsToSpans(chars);
}

// Vowel characters used by the (dictionary-free) hyphenation heuristic.
const VOWELS = new Set([
  'a',
  'e',
  'i',
  'o',
  'u',
  'y',
  'а',
  'е',
  'ё',
  'и',
  'о',
  'у',
  'ы',
  'э',
  'ю',
  'я',
]);

// Find the best break point for hyphenating a long word. Prefers a
// vowel→consonant boundary (e.g. "hyphen-ate", "su-per") scanning from the
// end of the keep window towards the start, leaving at least two chars on
// the current line so the hyphen doesn't dangle. Falls back to the full
// keep width (plain hard break) when no boundary is found.
function hyphenBreakAt(line: Char[], max: number): number {
  const limit = Math.min(max, line.length);
  for (let i = limit - 1; i >= 2; i--) {
    const prev = line[i - 1]!.ch.toLowerCase();
    const cur = line[i]!.ch.toLowerCase();
    if (VOWELS.has(prev) && !VOWELS.has(cur)) return i;
  }
  return limit;
}

export interface WrappedLines {
  lines: StyledSpan[][];
  // Number of original (non-inserted) chars per line. Hyphenation inserts a
  // '-' that does not exist in the source text; offset bookkeeping must count
  // only original chars or search/progress offsets drift.
  originalLengths: number[];
}

export function wrapSpans(
  spans: StyledSpan[],
  maxWidth: number,
  highlights: HighlightRange[] = [],
  hyphenate = false,
): WrappedLines {
  const styled = applyHighlights(spans, highlights);
  const chars: Char[] = [];
  let offset = 0;
  for (const span of styled) {
    for (const ch of span.text) {
      chars.push({
        ch,
        style: {
          bold: !!span.bold,
          italic: !!span.italic,
          underline: !!span.underline,
          strike: !!span.strike,
          link: !!span.link,
          highlight: !!span.highlight,
        },
        offset,
      });
      offset += 1;
    }
  }
  const wrapped = wrapChars(chars, maxWidth, hyphenate);
  return {
    lines: wrapped.map(charsToSpans),
    originalLengths: wrapped.map((line) => line.reduce((n, c) => n + (c.offset >= 0 ? 1 : 0), 0)),
  };
}

function wrapChars(chars: Char[], maxWidth: number, hyphenate: boolean): Char[][] {
  const lines: Char[][] = [];
  let line: Char[] = [];
  let width = 0;
  let lastSpace = -1;

  const flushLine = (): void => {
    const trimmed = line;
    let end = trimmed.length;
    while (end > 0 && trimmed[end - 1]!.ch === ' ') end -= 1;
    lines.push(trimmed.slice(0, end));
    line = [];
    width = 0;
    lastSpace = -1;
  };

  for (const char of chars) {
    const w = displayWidth(char.ch);
    if (char.ch === ' ') lastSpace = line.length;
    if (width + w > maxWidth && line.length > 0) {
      if (lastSpace > 0 && lastSpace < line.length) {
        lines.push(line.slice(0, lastSpace));
        line = line.slice(lastSpace + 1);
        width = line.reduce((acc, c) => acc + displayWidth(c.ch), 0);
        // The remainder starts after the last space, so it can never contain one.
        lastSpace = -1;
      } else if (
        hyphenate &&
        char.ch !== ' ' &&
        line.length > 1 &&
        line[0]!.ch !== ' ' &&
        line[line.length - 1]!.ch !== ' '
      ) {
        // A single word longer than the line: keep as many chars as fit
        // (leaving room for the hyphen), append '-', and continue the word
        // on the next line. The inserted hyphen gets offset -1 so it never
        // counts toward original-text offsets.
        // Guard against maxWidth - 1 <= 1: hyphenBreakAt would fall through
        // to limit 0, producing an empty kept array (and a style read off the
        // end of it). Never keep fewer than one char.
        const keep = hyphenBreakAt(line, Math.max(1, maxWidth - 1));
        const kept = line.slice(0, keep);
        const hyphen: Char = {
          ch: '-',
          style: { ...kept[kept.length - 1]!.style, highlight: false },
          offset: -1,
        };
        lines.push([...kept, hyphen]);
        line = line.slice(keep);
        width = line.reduce((acc, c) => acc + displayWidth(c.ch), 0);
        lastSpace = -1;
      } else {
        flushLine();
      }
    }
    line.push(char);
    width += w;
  }
  if (line.length > 0) {
    let end = line.length;
    while (end > 0 && line[end - 1]!.ch === ' ') end -= 1;
    lines.push(line.slice(0, end));
  }
  return lines;
}

function sliceHighlights(
  highlights: HighlightRange[] | undefined,
  base: number,
  length: number,
): HighlightRange[] {
  if (!highlights || base < 0) return [];
  const out: HighlightRange[] = [];
  for (const h of highlights) {
    const start = Math.max(0, h.start - base);
    const end = Math.min(length, h.end - base);
    if (start < end) out.push({ start, end });
  }
  return out;
}

function partCounter(opts: { skipEmpty?: boolean; separator?: string }): {
  push(text: string): number;
} {
  let offset = 0;
  let pending = false;
  return {
    push(text: string): number {
      if (opts.skipEmpty && text === '') return -1;
      if (pending) offset += (opts.separator ?? '\n').length;
      const start = offset;
      offset += text.length;
      pending = true;
      return start;
    },
  };
}

function spansToPlain(spans: StyledSpan[]): string {
  return spans.map((s) => s.text).join('');
}

function highlightPlain(text: string, highlights: HighlightRange[]): StyledSpan[] {
  const chars: Char[] = [];
  let offset = 0;
  for (const ch of text) {
    const inRange = highlights.some((h) => offset >= h.start && offset < h.end);
    chars.push({ ch, style: { ...EMPTY_STYLE, highlight: inRange }, offset });
    offset += 1;
  }
  return charsToSpans(chars);
}

function mergeSpanLines(lines: StyledSpan[][]): StyledSpan[] {
  const result: StyledSpan[] = [];
  for (const line of lines) result.push(...line);
  return result;
}

// Justify a single rendered line by distributing extra spaces between words.
// Only applied to non-final lines of justified blocks (paragraph/heading/
// quote/epigraph/annotation) that have more than one word — the last line of
// a paragraph and lines with a single long word stay left-aligned.
//
// The extra spaces are inserted by widening existing space characters inside
// span.text rather than emitting new spans, so style information (bold/italic/
// link/highlight) is preserved. Wide-glyph width is respected via
// displayWidth, so CJK content won't be over-stretched.
function justifyLine(line: TextLine, contentWidth: number): TextLine {
  if (line.role === 'empty' || line.spans.length === 0) return line;
  // Count spaces across all spans and compute current width.
  let spaceCount = 0;
  let textWidth = 0;
  for (const span of line.spans) {
    for (const ch of span.text) {
      if (ch === ' ') spaceCount += 1;
    }
    textWidth += displayWidth(span.text);
  }
  if (spaceCount === 0) return line;
  const slack = contentWidth - textWidth;
  if (slack <= 0) return line;
  // Even distribution: each gap gets floor(slack/gaps) extra spaces, and the
  // first (slack % gaps) gaps get one more. This matches the classical
  // text-justify:inter-word behavior.
  const gaps = spaceCount;
  const base = Math.floor(slack / gaps);
  const extra = slack % gaps;
  const spans = line.spans.map((s) => ({ ...s }));
  let applied = 0;
  for (const span of spans) {
    if (!span.text.includes(' ')) continue;
    let out = '';
    for (const ch of span.text) {
      if (ch === ' ') {
        const pad = base + (applied < extra ? 1 : 0);
        applied += 1;
        out += ' ' + ' '.repeat(pad);
      } else {
        out += ch;
      }
    }
    span.text = out;
  }
  return { ...line, spans };
}

// Apply justify to non-final lines of justifiable block types. Mutates the
// array in place and returns it. Called from the paragraph/heading/quote/
// epigraph/annotation cases before they return.
function applyJustify(lines: TextLine[], width: number): TextLine[] {
  if (lines.length <= 1) return lines;
  const justifiableRoles: LineRole[] = [
    'paragraph',
    'heading1',
    'heading2',
    'heading3',
    'heading4',
    'heading5',
    'heading6',
    'quote',
    'epigraph',
    'annotation',
  ];
  let lastContentIdx = lines.length - 1;
  while (lastContentIdx >= 0 && lines[lastContentIdx]!.role === 'empty') {
    lastContentIdx -= 1;
  }
  for (let i = 0; i < lastContentIdx; i++) {
    const line = lines[i]!;
    if (!justifiableRoles.includes(line.role)) continue;
    const contentWidth = width - line.indent - line.prefix.length;
    lines[i] = justifyLine(line, contentWidth);
  }
  return lines;
}

export function layoutBlock(block: Block, blockIndex: number, opts: LayoutOptions): TextLine[] {
  const { typo, width } = opts;
  const justify = !!opts.justify;
  const highlights = opts.getHighlights ? opts.getHighlights(blockIndex) : undefined;
  const lines: TextLine[] = [];

  const emit = (
    role: LineRole,
    spans: StyledSpan[],
    indent: number,
    prefix = '',
    charOffset = 0,
  ): void => {
    if (spans.length === 0 || spans.every((s) => s.text.trim() === '')) {
      if (role === 'paragraph' || role === 'listItem' || role === 'quote') {
        lines.push({ role: 'empty', spans: [], indent, prefix, blockIndex, charOffset });
      }
      return;
    }
    lines.push({ role, spans, indent, prefix, blockIndex, charOffset });
    if (typo.lineSpacing > 0 && role !== 'empty') {
      for (let i = 0; i < typo.lineSpacing; i++) {
        lines.push({ role: 'empty', spans: [], indent: 0, prefix: '', blockIndex, charOffset });
      }
    }
  };

  switch (block.type) {
    case 'empty':
      lines.push({ role: 'empty', spans: [], indent: 0, prefix: '', blockIndex, charOffset: 0 });
      return lines;
    case 'heading': {
      const spans = inlineToSpans(block.children);
      const wrapped = wrapSpans(spans, width, highlights, typo.hyphenation);
      let running = 0;
      for (let i = 0; i < wrapped.lines.length; i++) {
        const line = wrapped.lines[i]!;
        const text = spansToPlain(line);
        const offset = findOffsetOfLine(spans, line, running, text);
        running += wrapped.originalLengths[i]!;
        emit(`heading${Math.min(block.level, 6)}` as LineRole, line, 0, '', offset);
      }
      return justify ? applyJustify(lines, width) : lines;
    }
    case 'paragraph': {
      const spans = inlineToSpans(block.children);
      const wrapped = wrapSpans(spans, width, highlights, typo.hyphenation);
      let first = true;
      let running = 0;
      for (let i = 0; i < wrapped.lines.length; i++) {
        const line = wrapped.lines[i]!;
        const text = spansToPlain(line);
        const offset = findOffsetOfLine(spans, line, running, text);
        running += wrapped.originalLengths[i]!;
        emit('paragraph', line, first ? typo.paragraphIndent : 0, '', offset);
        first = false;
      }
      if (typo.paragraphSpacing > 0 && wrapped.lines.length > 0) {
        for (let i = 0; i < typo.paragraphSpacing; i++) {
          lines.push({
            role: 'empty',
            spans: [],
            indent: 0,
            prefix: '',
            blockIndex,
            charOffset: running,
          });
        }
      }
      return justify ? applyJustify(lines, width) : lines;
    }
    case 'code': {
      // Pre-formatted text: no wrapping, no justify, no hyphenation.
      // Each line of the source becomes a layout line verbatim.
      const text =
        block.children.length > 0 && block.children[0]!.kind === 'code'
          ? block.children[0]!.text
          : spansToPlain(inlineToSpans(block.children));
      const codeLines = text.split('\n');
      let running = 0;
      for (const cl of codeLines) {
        const spans: StyledSpan[] = [{ text: cl }];
        emit('code', spans, 0, '', running);
        running += cl.length + 1; // +1 for the \n
      }
      return lines;
    }
    case 'quote': {
      const spans = inlineToSpans(block.children);
      const wrapped = wrapSpans(spans, width - 4, highlights, typo.hyphenation);
      let running = 0;
      for (let i = 0; i < wrapped.lines.length; i++) {
        emit('quote', wrapped.lines[i]!, 4, '', running);
        running += wrapped.originalLengths[i]!;
      }
      return justify ? applyJustify(lines, width) : lines;
    }
    case 'epigraph': {
      const spans = inlineToSpans(block.children);
      const wrapped = wrapSpans(spans, width - 6, highlights, typo.hyphenation);
      let running = 0;
      for (let i = 0; i < wrapped.lines.length; i++) {
        emit('epigraph', wrapped.lines[i]!, 6, '', running);
        running += wrapped.originalLengths[i]!;
      }
      return justify ? applyJustify(lines, width) : lines;
    }
    case 'annotation': {
      const spans = inlineToSpans(block.children);
      const wrapped = wrapSpans(spans, width, highlights, typo.hyphenation);
      let running = 0;
      for (let i = 0; i < wrapped.lines.length; i++) {
        emit('annotation', wrapped.lines[i]!, 0, '', running);
        running += wrapped.originalLengths[i]!;
      }
      return justify ? applyJustify(lines, width) : lines;
    }
    case 'list': {
      const offsets = partCounter({ skipEmpty: true });
      // Each <ol>/<ul> has its own counter (matching HTML semantics). A nested
      // list restarts at 1, not "continue parent's counter" — the previous
      // version shared one counter across all levels and pre-advanced it via
      // walkCounter, which corrupted ordered-list numbering for nested lists.
      const walk = (list: Extract<Block, { type: 'list' }>, level: number): void => {
        let counter = 1;
        for (const item of list.items) {
          const marker = list.ordered ? `${counter}.` : '-';
          counter += list.ordered ? 1 : 0;
          const indent = 2 + level * 2;
          const markerWidth = marker.length + 1;
          const spans = inlineToSpans(item.children);
          const plain = spansToPlain(spans);
          const start = offsets.push(plain);
          const hls = sliceHighlights(highlights, start, plain.length);
          const wrapped = wrapSpans(spans, width - indent - markerWidth, hls, typo.hyphenation);
          if (wrapped.lines.length === 0) {
            lines.push({
              role: 'listItem',
              spans: [],
              indent,
              prefix: `${marker} `,
              blockIndex,
              charOffset: Math.max(0, start),
            });
          }
          let running = 0;
          for (let i = 0; i < wrapped.lines.length; i++) {
            lines.push({
              role: 'listItem',
              spans: wrapped.lines[i]!,
              indent,
              prefix: i === 0 ? `${marker} ` : ' '.repeat(markerWidth),
              blockIndex,
              charOffset: Math.max(0, start) + running,
            });
            running += wrapped.originalLengths[i]!;
          }
          for (const nested of item.nested) {
            if (nested.type === 'list') {
              walk(nested, level + 1);
            }
          }
        }
      };
      walk(block, 0);
      return lines;
    }
    case 'poem': {
      const offsets = partCounter({ skipEmpty: false });
      block.stanzas.forEach((stanza, si) => {
        if (si > 0) {
          lines.push({
            role: 'empty',
            spans: [],
            indent: 0,
            prefix: '',
            blockIndex,
            charOffset: 0,
          });
        }
        for (const verse of stanza.lines) {
          const spans = inlineToSpans(verse);
          const plain = spansToPlain(spans);
          const start = offsets.push(plain);
          const hls = sliceHighlights(highlights, start, plain.length);
          const wrapped = wrapSpans(spans, width - 6, hls, typo.hyphenation);
          let running = 0;
          for (let i = 0; i < wrapped.lines.length; i++) {
            emit('poemLine', wrapped.lines[i]!, 6, '', Math.max(0, start) + running);
            running += wrapped.originalLengths[i]!;
          }
        }
      });
      return lines;
    }
    case 'table': {
      return layoutTable(block, blockIndex, width, highlights);
    }
    case 'image': {
      const alt = block.alt || 'image';
      const text = `[Image: ${alt}]`;
      const indent = Math.max(0, Math.floor((width - text.length) / 2));
      lines.push({
        role: 'image',
        spans: [{ text }],
        indent,
        prefix: '',
        blockIndex,
        charOffset: 0,
      });
      // Reserve blank lines under the placeholder so the ueberzugpp overlay
      // (IMAGE_ROWS tall) doesn't cover the text that follows.
      for (let r = 1; r < IMAGE_ROWS; r++) {
        lines.push({ role: 'empty', spans: [], indent: 0, prefix: '', blockIndex, charOffset: 0 });
      }
      return lines;
    }
  }
  return lines;
}

function findOffsetOfLine(
  spans: StyledSpan[],
  line: StyledSpan[],
  baseOffset: number,
  lineText: string,
): number {
  if (lineText.trim() === '') return baseOffset;
  const plain = mergeSpanLines([spans])
    .map((s) => s.text)
    .join('');
  let linePlain = line.map((s) => s.text).join('');
  // A hyphenation pass appends a '-' that is not part of the source text;
  // strip it so the plain-text search still finds the word start.
  if (linePlain.endsWith('-')) linePlain = linePlain.slice(0, -1);
  const trimmed = linePlain.trim();
  // baseOffset is the running sum of previous line text lengths (without
  // inter-line break spaces), which is always ≤ the actual offset in the full
  // plain text. So indexOf from baseOffset will find the correct occurrence.
  // ponytail: O(n) per line via indexOf from baseOffset, not O(n²) full-scan.
  // Total across a paragraph is O(plain.length) — indexOf advances baseOffset
  // each call. Upgrade to a running cursor only if a profile shows hot spots.
  const idx = plain.indexOf(trimmed, baseOffset);
  if (idx >= 0) return idx;
  return baseOffset;
}

function layoutTable(
  block: Extract<Block, { type: 'table' }>,
  blockIndex: number,
  width: number,
  highlights: HighlightRange[] | undefined,
): TextLine[] {
  const lines: TextLine[] = [];
  const colCount = Math.max(block.headers.length, ...block.rows.map((r) => r.length));
  if (colCount === 0) return lines;
  const allRows: { cells: string[]; isHeader: boolean }[] = [];
  if (block.headers.length > 0) {
    allRows.push({ cells: block.headers.map((c) => inlinesToText(c)), isHeader: true });
  }
  for (const row of block.rows) {
    allRows.push({ cells: row.map((c) => inlinesToText(c)), isHeader: false });
  }
  const pad = 2;
  const availPerCol = Math.max(4, Math.floor((width - (colCount - 1) * pad) / colCount));
  const colWidths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let maxLen = 0;
    for (const row of allRows) {
      const cell = row.cells[c] ?? '';
      maxLen = Math.max(maxLen, cell.length);
    }
    colWidths.push(Math.min(availPerCol, Math.max(4, maxLen)));
  }

  let running = 0;
  for (let ri = 0; ri < allRows.length; ri++) {
    const row = allRows[ri]!;
    const cellStartOffsets: number[] = [];
    if (!row.isHeader) {
      for (let c = 0; c < colCount; c++) {
        const cell = row.cells[c] ?? '';
        cellStartOffsets.push(running);
        running += cell.length + 1;
      }
    }
    const wrappedCells: StyledSpan[][][] = Array.from({ length: colCount }, (_, c) => {
      const cell = row.cells[c] ?? '';
      const w = colWidths[c]!;
      if (row.isHeader) {
        return wrapSpans([{ text: cell }], w, []).lines;
      }
      // Non-header rows always fill one entry per column above.
      const hls = sliceHighlights(highlights, cellStartOffsets[c]!, cell.length);
      return wrapSpans(highlightPlain(cell, hls), w, []).lines;
    });
    const rowHeight = Math.max(1, ...wrappedCells.map((ws) => ws.length));
    for (let r = 0; r < rowHeight; r++) {
      const spans: StyledSpan[] = [];
      let lineCharOffset = -1;
      for (let c = 0; c < colCount; c++) {
        const cell = wrappedCells[c]!;
        const cellLine = cell[r];
        if (lineCharOffset < 0 && cellLine && spansToPlain(cellLine).trim() !== '') {
          lineCharOffset = cellStartOffsets[c] ?? 0;
        }
        const text = cellLine ? spansToPlain(cellLine) : '';
        const padded = text.padEnd(colWidths[c]!);
        if (cellLine) {
          spans.push(...cellLine);
          if (padded.length > text.length)
            spans.push({ text: ' '.repeat(padded.length - text.length) });
        } else {
          spans.push({ text: padded });
        }
        if (c < colCount - 1) spans.push({ text: ' '.repeat(pad) });
      }
      // Non-header rows always fill at least one entry per row above.
      if (lineCharOffset < 0) lineCharOffset = row.isHeader ? 0 : cellStartOffsets[0]!;
      lines.push({
        role: row.isHeader ? 'tableHeader' : 'tableCell',
        spans,
        indent: 0,
        prefix: '',
        blockIndex,
        charOffset: lineCharOffset,
      });
    }
  }
  return lines;
}

export class BookLayout {
  readonly blockCount: number;
  private readonly blocks: Block[];
  private readonly opts: LayoutOptions;
  private lines: TextLine[] = [];
  private nextBlockToLayout = 0;
  private readonly blockStarts: number[];
  private readonly blockText: string[];
  private readonly blockCharStarts: number[];
  readonly totalChars: number;

  constructor(blocks: Block[], opts: LayoutOptions) {
    this.blocks = blocks;
    this.opts = opts;
    this.blockCount = blocks.length;
    this.blockStarts = new Array<number>(blocks.length + 1).fill(-1);
    this.blockStarts[0] = 0;
    this.blockText = blocks.map(blockToPlainText);
    this.blockCharStarts = new Array<number>(blocks.length + 1).fill(0);
    let acc = 0;
    for (let i = 0; i < blocks.length; i++) {
      this.blockCharStarts[i] = acc;
      acc += this.blockText[i]!.length;
    }
    this.blockCharStarts[blocks.length] = acc;
    this.totalChars = acc;
  }

  ensureBlocksUpTo(blockIndex: number): void {
    const target = Math.min(blockIndex, this.blocks.length - 1);
    while (this.nextBlockToLayout <= target) {
      const idx = this.nextBlockToLayout;
      const blockLines = layoutBlock(this.blocks[idx]!, idx, this.opts);
      this.lines.push(...blockLines);
      this.nextBlockToLayout += 1;
      this.blockStarts[idx + 1] = this.lines.length;
    }
  }

  ensureLineCount(count: number): number {
    while (this.lines.length < count && this.nextBlockToLayout < this.blocks.length) {
      const idx = this.nextBlockToLayout;
      const blockLines = layoutBlock(this.blocks[idx]!, idx, this.opts);
      this.lines.push(...blockLines);
      this.nextBlockToLayout += 1;
      this.blockStarts[idx + 1] = this.lines.length;
    }
    return this.lines.length;
  }

  lineCount(): number {
    return this.ensureLineCount(Infinity);
  }

  getPage(page: number, pageHeight: number): TextLine[] {
    if (pageHeight <= 0) return [];
    const start = page * pageHeight;
    this.ensureLineCount(start + pageHeight);
    return this.lines.slice(start, start + pageHeight);
  }

  getRange(start: number, count: number): TextLine[] {
    if (count <= 0) return [];
    this.ensureLineCount(start + count);
    return this.lines.slice(start, start + count);
  }

  pageForCharOffset(charOffset: number, pageHeight: number): number {
    if (charOffset <= 0 || this.totalChars === 0) return 0;
    const targetBlock = this.blockForCharOffset(charOffset);
    this.ensureBlocksUpTo(targetBlock);
    const local = charOffset - this.blockCharStarts[targetBlock]!;
    const blockStart = this.blockStarts[targetBlock]!;
    let lineIdx = 0;
    for (let i = blockStart; i < this.blockStarts[targetBlock + 1]!; i++) {
      const line = this.lines[i]!;
      if (line.charOffset > local) break;
      lineIdx = i;
    }
    const absLine = lineIdx;
    return Math.max(0, Math.floor(absLine / pageHeight));
  }

  private blockForCharOffset(charOffset: number): number {
    let lo = 0;
    let hi = this.blockCount - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.blockCharStarts[mid]! <= charOffset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  textNear(charOffset: number, length = 60): string {
    if (this.blockCount === 0) return '';
    const safe = Math.max(0, Math.min(charOffset, this.totalChars - 1));
    const block = this.blockForCharOffset(safe);
    const local = safe - this.blockCharStarts[block]!;
    const text = this.blockText[block]!;
    return text
      .slice(local, local + length)
      .replace(/\s+/g, ' ')
      .trim();
  }

  estimateLineCount(): number {
    if (this.opts.width <= 0) return 1;
    return Math.max(1, Math.ceil(this.totalChars / Math.max(1, this.opts.width * 0.8)));
  }

  blockStartLine(blockIndex: number): number | undefined {
    this.ensureBlocksUpTo(blockIndex);
    return this.blockStarts[blockIndex];
  }

  lineForBlock(blockIndex: number): number {
    this.ensureBlocksUpTo(blockIndex);
    return this.blockStarts[blockIndex]!;
  }

  // Book-wide char offset where block `blockIndex` begins. Search matches
  // carry block-local offsets; the reader adds this base to jump to the
  // right block. See jumpToMatch in readerModel.ts.
  blockCharStart(blockIndex: number): number {
    return this.blockCharStarts[blockIndex] ?? 0;
  }

  lineForCharOffset(charOffset: number): number {
    if (this.blockCount === 0) return 0;
    const safe = Math.max(0, Math.min(charOffset, this.totalChars - 1));
    const block = this.blockForCharOffset(safe);
    this.ensureBlocksUpTo(block);
    const local = safe - this.blockCharStarts[block]!;
    const start = this.blockStarts[block]!;
    let result = start;
    const end = this.blockStarts[block + 1]!;
    for (let i = start; i < end; i++) {
      const line = this.lines[i]!;
      if (line.charOffset > local) break;
      result = i;
    }
    return result;
  }

  charOffsetForLine(line: number): number {
    if (line <= 0) return 0;
    this.ensureLineCount(line + 1);
    const tl = this.lines[line];
    if (!tl) return this.totalChars;
    return this.blockCharStarts[tl.blockIndex]! + tl.charOffset;
  }

  invalidate(): void {
    this.lines = [];
    this.nextBlockToLayout = 0;
    this.blockStarts.fill(-1);
    this.blockStarts[0] = 0;
  }
}
