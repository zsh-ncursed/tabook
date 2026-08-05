import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LibraryDb } from '../db/db.js';
import { BookmarksManager } from './index.js';
import { BookLayout } from '../renderer/layout.js';
import { defaultConfig } from '../config/defaults.js';
import type { Block, BookMetadata } from '../formats/model.js';

const typo = defaultConfig().typography;
const metadata: BookMetadata = { title: 'B', authors: [], genres: [], annotation: '' };

let dir: string;
let db: LibraryDb;
let bookId: number;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabook-bm-'));
  db = new LibraryDb(path.join(dir, 'bm.sqlite'));
  bookId = db.addBook({
    path: '/tmp/b.fb2',
    filename: 'b.fb2',
    format: 'fb2',
    size: 10,
    metadata,
  });
});

afterEach(() => {
  db.close();
});

function text(t: string): { kind: 'text'; text: string } {
  return { kind: 'text', text: t };
}

describe('BookmarksManager', () => {
  it('adds and lists bookmarks with previews', () => {
    const layout = new BookLayout(
      [{ type: 'paragraph', children: [text('The quick brown fox jumps')] }] as Block[],
      { typo, width: 40 },
    );
    const manager = new BookmarksManager(db, layout);
    const id = manager.add({ bookId, position: 10, label: 'start' });
    const list = manager.list(bookId);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(id);
    expect(list[0]!.label).toBe('start');
    expect(list[0]!.preview.length).toBeGreaterThan(0);
  });

  it('trims labels and defaults to empty', () => {
    const manager = new BookmarksManager(db);
    const id = manager.add({ bookId, position: 5, label: '   spaced   ' });
    expect(manager.get(id)!.label).toBe('spaced');
    const empty = manager.add({ bookId, position: 6 });
    expect(manager.get(empty)!.label).toBe('');
  });

  it('returns an empty preview without a layout', () => {
    const manager = new BookmarksManager(db);
    const id = manager.add({ bookId, position: 5 });
    expect(manager.get(id)!.preview).toBe('');
  });

  it('removes bookmarks and handles missing ids', () => {
    const manager = new BookmarksManager(db);
    const id = manager.add({ bookId, position: 5 });
    expect(manager.remove(id)).toBe(true);
    expect(manager.remove(id)).toBe(false);
    expect(manager.get(id)).toBeUndefined();
  });
});
