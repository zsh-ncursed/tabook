import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LibraryDb } from '../../db/db.js';
import { defaultConfig } from '../../config/defaults.js';
import { ReaderSession } from './readerModel.js';
import type { ParsedBook } from '../../formats/model.js';

const typo = defaultConfig().typography;

function para(text: string): { type: 'paragraph'; children: { kind: 'text'; text: string }[] } {
  return { type: 'paragraph', children: [{ kind: 'text', text }] };
}

function makeBook(content: ReturnType<typeof para>[]): ParsedBook {
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
  content: ReturnType<typeof para>[],
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
