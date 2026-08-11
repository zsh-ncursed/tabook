import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LibraryDb } from '../../db/db.js';
import { defaultConfig } from '../../config/defaults.js';
import { ReaderSession } from './readerModel.js';
import type { Block, ParsedBook } from '../../formats/model.js';

const typo = defaultConfig().typography;

function para(text: string): { type: 'paragraph'; children: { kind: 'text'; text: string }[] } {
  return { type: 'paragraph', children: [{ kind: 'text', text }] };
}

function makeBook(content: Block[]): ParsedBook {
  return {
    format: 'fb2',
    path: '/tmp/test.fb2',
    filename: 'test.fb2',
    size: 1000,
    metadata: { title: 'Test Book', authors: [], genres: [], annotation: '' },
    toc: [],
    content,
    resources: new Map(),
  };
}

let dir: string;
let db: LibraryDb;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabook-model-test-'));
  db = new LibraryDb(path.join(dir, 'lib.sqlite'));
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeSession(
  content: Block[],
  overrides: Partial<{ width: number; height: number; simplified: boolean }> = {},
): ReaderSession {
  return new ReaderSession(makeBook(content), {
    typo,
    simplified: overrides.simplified ?? false,
    width: overrides.width ?? 80,
    height: overrides.height ?? 24,
    db,
    bookId: null,
  });
}

describe('ReaderSession', () => {
  it('lays out viewport lines and reports page geometry', () => {
    const session = makeSession([para('hello world')]);
    expect(session.pageHeight()).toBe(21); // height 24 - 3
    const lines = session.viewportLines();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]!.spans.map((s) => s.text).join('')).toContain('hello world');
  });

  it('navigates with page down and percent', () => {
    // ~10000 chars at contentWidth 76 wrap to ~130 lines (> pageHeight 21),
    // so pageDown actually changes the page and goToPercent(100) reaches
    // near the end.
    const session = makeSession([para('a '.repeat(5000))]);
    const p0 = session.pageNumber;
    session.pageDown();
    expect(session.pageNumber).toBeGreaterThan(p0);
    session.goToStart();
    expect(session.currentLine).toBe(0);
    session.goToPercent(100);
    // Must not crash and should be near the end.
    expect(session.percent()).toBeGreaterThan(90);
  });

  it('searches and jumps to matches', () => {
    const session = makeSession([para('one two three'), para('three again'), para('nothing')]);
    session.setQuery('three');
    const state = session.searchState();
    expect(state.matches).toBe(2);
    session.nextMatch();
    expect(session.pageNumber).toBeGreaterThanOrEqual(0);
    session.nextMatch();
    session.prevMatch();
    expect(session.hasActiveQuery()).toBe(true);
    session.setQuery('');
    expect(session.hasActiveQuery()).toBe(false);
    expect(session.searchState().matches).toBe(0);
  });

  it('tracks Unicode search offsets against original text', () => {
    // 'İ' (U+0130) lowercases to a 2-code-point sequence ('i̇'), so a naive
    // whole-string toLowerCase() fold can't even find 'istanbul' in
    // 'xi̇stanbul y' (the combining dot breaks the substring). The fold map
    // must match it and report offsets in original-text coordinates.
    const session = makeSession([para('xİstanbul y'), para('zzz')]);
    session.setQuery('istanbul');
    expect(session.searchState().matches).toBe(1);
    session.nextMatch();
    // The whole paragraph fits on one line, so charOffset() is the line
    // start (0); the search match itself maps back to original offset 1
    // (verified by the search index unit tests).
    expect(session.charOffset()).toBe(0);
    expect(session.currentLine).toBe(0);
  });

  it('switches simplified mode and rebuilds layout', () => {
    const session = makeSession([para('regular')]);
    expect(session.isSimplified).toBe(false);
    session.setSimplified(true);
    expect(session.isSimplified).toBe(true);
    // A one-line paragraph renders a couple of lines (plus paragraphSpacing),
    // not a full viewport; just verify it lays out and keeps the position.
    const lines = session.viewportLines();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]!.spans.map((s) => s.text).join('')).toContain('regular');
  });

  it('toggles wide mode and justify', () => {
    const session = makeSession([para('regular text')]);
    session.setJustify(true);
    expect(session.isJustify).toBe(true);
    session.setWide(true);
    expect(session.isWide).toBe(true);
    expect(session.contentWidth()).toBe(Math.max(20, 80 - 2));
  });

  it('reports which chapters contain paragraphs and lists them', () => {
    const content = [
      { type: 'heading' as const, level: 1, children: [{ kind: 'text' as const, text: 'Ch 1' }] },
      para('first para'),
      para('second para'),
      { type: 'heading' as const, level: 1, children: [{ kind: 'text' as const, text: 'Ch 2' }] },
      para('third para'),
    ];
    const session = makeSession(content);
    session.book.toc = [
      { id: 'ch1', label: 'Ch 1', level: 1, blockIndex: 0 },
      { id: 'ch2', label: 'Ch 2', level: 1, blockIndex: 3 },
    ];
    // Real chapter ranges: ch1 spans blocks 1-2, ch2 block 4 (to end of book).
    expect(session.chapterHasParagraphs('ch1')).toBe(true);
    expect(session.chapterParagraphs('ch1').map((p) => p.label)).toEqual([
      'first para',
      'second para',
    ]);
    expect(session.chapterParagraphs('ch1')[0]!.blockIndex).toBe(1);
    expect(session.chapterHasParagraphs('ch2')).toBe(true);
    expect(session.chapterParagraphs('ch2').map((p) => p.label)).toEqual(['third para']);
    // Unknown ids and empty ranges are safe.
    expect(session.chapterHasParagraphs('nope')).toBe(false);
    expect(session.chapterParagraphs('nope')).toEqual([]);
  });

  it('marks a chapter with only nested headings as empty (no paragraphs)', () => {
    const content = [
      { type: 'heading' as const, level: 1, children: [{ kind: 'text' as const, text: 'Ch 1' }] },
      { type: 'heading' as const, level: 2, children: [{ kind: 'text' as const, text: 'Sub' }] },
      { type: 'heading' as const, level: 1, children: [{ kind: 'text' as const, text: 'Ch 2' }] },
    ];
    const session = makeSession(content);
    session.book.toc = [
      { id: 'ch1', label: 'Ch 1', level: 1, blockIndex: 0 },
      { id: 'sub', label: 'Sub', level: 2, blockIndex: 1 },
      { id: 'ch2', label: 'Ch 2', level: 1, blockIndex: 2 },
    ];
    // ch1's range (blocks 1-1) contains only a heading, no paragraph.
    expect(session.chapterHasParagraphs('ch1')).toBe(false);
    expect(session.chapterParagraphs('ch1')).toEqual([]);
  });

  it('jumps to the right block via TOC in simplified mode (block indices remapped)', () => {
    // Book where simplification changes block indices: an image is dropped and
    // a two-item list expands into two paragraphs. TOC entries reference
    // original book.content indices, so goToToc must remap them.
    const content: Block[] = [
      { type: 'image', src: 'x', alt: 'pic' }, // original 0 → dropped
      { type: 'heading', level: 1, children: [{ kind: 'text', text: 'Chapter One' }] }, // original 1 → simplified 0
      { type: 'list', ordered: false, items: [{ children: [{ kind: 'text', text: 'a' }], nested: [] }, { children: [{ kind: 'text', text: 'b' }], nested: [] }] }, // original 2 → simplified 1..2
      { type: 'paragraph', children: [{ kind: 'text', text: 'middle text' }] }, // original 3 → simplified 3
      { type: 'heading', level: 1, children: [{ kind: 'text', text: 'Chapter Two' }] }, // original 4 → simplified 4
    ];
    const session = makeSession(content, { simplified: true });
    session.book.toc = [
      { id: 'c1', label: 'Chapter One', level: 1, blockIndex: 1 },
      { id: 'c2', label: 'Chapter Two', level: 1, blockIndex: 4 },
    ];

    // Jump to the second chapter: original block 4 → simplified block 4.
    session.goToToc(4);
    const lines = session.viewportLines();
    expect(lines.map((l) => l.spans.map((s) => s.text).join('')).join(' ')).toContain(
      'Chapter Two',
    );

    // Jump to the first chapter: original block 1 → simplified block 0 (the
    // image before it was dropped). Without remapping this would land on the
    // first list item instead.
    session.goToToc(1);
    const firstLines = session.viewportLines();
    expect(firstLines.map((l) => l.spans.map((s) => s.text).join('')).join(' ')).toContain(
      'Chapter One',
    );
  });

  it('keeps TOC jumps correct in normal mode (indices unchanged)', () => {
    const content: Block[] = [
      { type: 'heading', level: 1, children: [{ kind: 'text', text: 'Chapter One' }] },
      para('first para'),
      { type: 'heading', level: 1, children: [{ kind: 'text', text: 'Chapter Two' }] },
    ];
    const session = makeSession(content);
    session.book.toc = [
      { id: 'c1', label: 'Chapter One', level: 1, blockIndex: 0 },
      { id: 'c2', label: 'Chapter Two', level: 1, blockIndex: 2 },
    ];
    session.goToToc(2);
    const lines = session.viewportLines();
    expect(lines.map((l) => l.spans.map((s) => s.text).join('')).join(' ')).toContain(
      'Chapter Two',
    );
  });

  it('persists progress when the book has a library id', () => {
    const id = db.addBook({
      path: '/tmp/persist.fb2',
      filename: 'persist.fb2',
      format: 'fb2',
      size: 1,
      metadata: { title: 'Persist', authors: [], genres: [], annotation: '' },
    });
    const session = new ReaderSession(makeBook([para('long '.repeat(200))]), {
      typo,
      simplified: false,
      width: 80,
      height: 24,
      db,
      bookId: id,
    });
    session.scrollDown(5);
    session.saveProgress();
    const progress = db.getProgress(id);
    expect(progress).toBeDefined();
    expect(progress!.position).toBe(session.charOffset());
  });
});
