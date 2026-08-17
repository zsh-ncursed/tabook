// Shared helpers for the TS↔Rust parity (golden) test suite.
//
// Every feature is implemented twice — a Rust core exposed through the napi
// binding (crates/tabook-native) and a pure-TS fallback used when the binding
// is absent. The parity tests feed identical fixtures to both implementations
// and assert they produce identical output, so a fix applied to only one side
// (the recurring "audit bugfix" drift) is caught here.
//
// The two sides legitimately differ in *shape* (napi-rs returns every optional
// field, usually as null; the TS code omits absent keys; native StyledSpan
// always carries all six style booleans), so comparisons go through the
// canonicalizers below instead of raw deep-equals.

import { readFileSync } from 'node:fs';
import { getNative, getNativeLoadError, isNativeAvailable, whenNativeReady } from '../native.js';
import type * as NativeTypes from '@tabook/native';
import type { Block, Inline } from '../formats/model.js';
import type { TextLine } from '../renderer/layout.js';
import type { TypographyConfig } from '../config/defaults.js';

// The binding may load asynchronously (the dynamic-import path in native.ts);
// await readiness so the snapshot below is never taken while it is still
// null — that race used to silently skip the whole parity suite.
await whenNativeReady();

export const native: typeof NativeTypes | null = isNativeAvailable() ? getNative() : null;

/** Guard used at the top of each parity file: the committed .node binding is
 *  loaded in tests, but skip loudly if it is ever missing. */
export function requireNative(): typeof NativeTypes {
  if (!native) {
    const reason = getNativeLoadError();
    throw new Error(
      'native module not available — parity tests require the committed .node binding ' +
        '(rebuild with npm run build:native)' +
        (reason ? ` — ${reason}` : ''),
    );
  }
  return native;
}

// Recursively drop null/undefined values so the two implementations' optional
// fields compare equal regardless of presence. Keeps 0, false and ''.
export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      out[k] = stripNulls(v);
    }
    return out;
  }
  return value;
}

// FB2 authors: the TS parser always sets middleName/nickname to '' when
// absent, the Rust side emits None (dropped here). Semantically identical —
// joinAuthors filters empty strings — so normalize '' to absent.
function canonicalAuthors(authors: unknown): unknown {
  if (!Array.isArray(authors)) return authors;
  return authors.map((a) => {
    if (!a || typeof a !== 'object') return a;
    const rec = a as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (v === null || v === undefined) continue;
      if ((k === 'middleName' || k === 'nickname') && v === '') continue;
      out[k] = v;
    }
    return out;
  });
}

// Native resources arrive as [{ key, data }] (data a Uint8Array/number[]),
// TS ParsedBook carries Map<string, Uint8Array>. Canonical form: sorted
// array of [key, base64] pairs.
export function canonicalResources(
  resources: Map<string, Uint8Array> | Array<{ key: string; data: Uint8Array | number[] }>,
): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (resources instanceof Map) {
    for (const [k, v] of resources) entries.push([k, Buffer.from(v).toString('base64')]);
  } else {
    for (const r of resources)
      entries.push([r.key, Buffer.from(r.data as Uint8Array).toString('base64')]);
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return entries;
}

type AnyParsedBook = {
  format: string;
  path: string;
  filename: string;
  size: number;
  metadata: { authors?: unknown };
  toc: unknown;
  content: unknown;
  resources: Map<string, Uint8Array> | Array<{ key: string; data: Uint8Array | number[] }>;
};

/** Canonical form of a BookMetadata for cross-implementation comparison. */
export function canonicalMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') return {} as Record<string, unknown>;
  const m = metadata as { authors?: unknown } & Record<string, unknown>;
  return stripNulls({ ...m, authors: canonicalAuthors(m.authors) }) as Record<string, unknown>;
}

/** Canonical form of a ParsedBook for cross-implementation comparison. */
export function canonicalBook(book: AnyParsedBook): Record<string, unknown> {
  const { resources, metadata, ...rest } = book;
  return stripNulls({
    ...rest,
    metadata: canonicalMetadata(metadata),
    resources: canonicalResources(resources),
  }) as Record<string, unknown>;
}

// Native StyledSpan always carries all six style booleans (false when unset);
// the TS layout only emits a key when the style is on. Normalize to the
// "truthy keys only" shape.
export function canonicalSpan(s: {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  link?: boolean;
  highlight?: boolean;
}): Record<string, unknown> {
  const out: Record<string, unknown> = { text: s.text };
  if (s.bold) out.bold = true;
  if (s.italic) out.italic = true;
  if (s.underline) out.underline = true;
  if (s.strike) out.strike = true;
  if (s.link) out.link = true;
  if (s.highlight) out.highlight = true;
  return out;
}

export function canonicalLine(line: TextLine): Record<string, unknown> {
  return {
    role: line.role,
    spans: line.spans.map(canonicalSpan),
    indent: line.indent,
    prefix: line.prefix,
    blockIndex: line.blockIndex,
    charOffset: line.charOffset,
  };
}

// Lay out the entire book through the chunked getRange API (the same path the
// reader uses to render pages) and return the canonical lines.
export function layoutAllLines(
  impl: { lineCount(): number; getRange(start: number, count: number): TextLine[] },
  chunk = 64,
): Record<string, unknown>[] {
  const total = impl.lineCount();
  const out: Record<string, unknown>[] = [];
  for (let start = 0; start < total; start += chunk) {
    for (const line of impl.getRange(start, chunk)) out.push(canonicalLine(line));
  }
  return out;
}

// ---- fixtures ---------------------------------------------------------------

export const T = (text: string): Inline => ({ kind: 'text', text });

/** A book exercising every layout block type, Cyrillic + CJK text, styles,
 *  links, a hyphenation candidate and an image placeholder. Used by the
 *  layout and search parity tests (search folds blockToPlainText). */
export function richBlocks(): Block[] {
  return [
    { type: 'heading', level: 1, children: [T('Глава первая — Введение')] },
    {
      type: 'paragraph',
      children: [
        T(
          'Обычный абзац с достаточно длинным текстом, который при узкой колонке обязательно перенесётся на несколько строк. ',
        ),
        { kind: 'bold', children: [T('жирный фрагмент')] },
        T(' и '),
        { kind: 'italic', children: [T('курсив')] },
        T(' вперемешку.'),
      ],
    },
    { type: 'paragraph', children: [T('Короткий абзац.')] },
    { type: 'quote', children: [T('Цитата с несколькими словами для проверки переноса.')] },
    { type: 'epigraph', children: [T('Эпиграф к произведению.')] },
    { type: 'annotation', children: [T('Аннотация издания.')] },
    {
      type: 'list',
      ordered: false,
      items: [
        { children: [T('Первый пункт списка')], nested: [] },
        {
          children: [T('Второй пункт')],
          nested: [
            {
              type: 'list',
              ordered: true,
              items: [{ children: [T('Вложенный нумерованный пункт')], nested: [] }],
            },
          ],
        },
      ],
    },
    { type: 'code', children: [{ kind: 'code', text: 'line1 of code\nline2 of code\nline3' }] },
    {
      type: 'poem',
      stanzas: [
        { lines: [[T('Строка стиха первая')], [T('Строка стиха вторая')]] },
        { lines: [[T('Вторая строфа, одна строка')]] },
      ],
    },
    {
      type: 'table',
      headers: [[T('Кол A')], [T('Кол B')]],
      rows: [
        [[T('a1')], [T('b1 длиннее')]],
        [[T('a2')], [T('b2')]],
      ],
    },
    { type: 'image', src: 'cover', alt: 'Обложка' },
    {
      type: 'paragraph',
      children: [
        T('Смешанный '),
        { kind: 'link', href: '#note1', children: [T('переход по ссылке')] },
        T(' и обычный текст после него.'),
      ],
    },
    { type: 'empty' },
    { type: 'paragraph', children: [T('Китайский текст: 漢字かな混じり文と日本語。')] },
    { type: 'paragraph', children: [T('Гидроэлектростанция не помещается в строку.')] },
  ];
}

export const TYPO: TypographyConfig = {
  measure: 80,
  lineSpacing: 0,
  paragraphIndent: 4,
  paragraphSpacing: 1,
  hyphenation: false,
  justify: false,
};

export const TYPO_JUSTIFY: TypographyConfig = { ...TYPO, hyphenation: true, justify: true };

// Char offsets to probe on both layout engines: start, mid-block, block
// boundaries, last char, and one past the end.
export function probeOffsets(totalChars: number): number[] {
  return [0, 1, 7, totalChars >> 1, Math.max(0, totalChars - 1), totalChars, totalChars + 5];
}

// Queries for the search parity suite: Cyrillic (case + whitespace folding),
// CJK, diacritics, list/table content, hyphenated words and no-match.
export const SEARCH_QUERIES = [
  'глава',
  'ГЛАВА',
  'первая',
  '  глава  ',
  'жирный',
  'гидроэлектростанция',
  'переход по ссылке',
  'Кол B',
  'a1',
  '漢字',
  'mixed',
  'no-such-query-zzz',
];

// ---- OPDS fixtures ----------------------------------------------------------

export function opdsFixture(name: string): string {
  return readFixture(`../opds/fixtures/${name}`);
}

export function readFixture(relativePath: string): string {
  return readText(new URL(relativePath, import.meta.url));
}

export function readText(url: URL): string {
  return readFileSync(url, 'utf8');
}
