// Verifies the better-sqlite3 fallback backend still works when the native
// module is unavailable (dev-only path; the release package ships native).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../native.js', () => ({ native: null, isNativeErrorResult: () => false }));

import { LibraryDb } from './db.js';
import type { BookMetadata } from '../formats/model.js';

const metadata: BookMetadata = {
  title: 'Fallback Book',
  authors: [{ firstName: 'Ann', lastName: 'Lee' }],
  genres: ['sf'],
  annotation: '',
};

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabook-fallback-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('LibraryDb better-sqlite3 fallback', () => {
  it('performs a CRUD cycle', () => {
    const db = new LibraryDb(path.join(dir, 'lib.sqlite'));
    const id = db.addBook({
      path: '/tmp/f.fb2',
      filename: 'f.fb2',
      format: 'fb2',
      size: 1,
      metadata,
    });
    expect(db.getBook(id)!.title).toBe('Fallback Book');
    db.setProgress(id, 100, 5);
    expect(db.getProgress(id)!.percent).toBe(5);
    const bm = db.addBookmark(id, 10, 'm');
    expect(db.getBookmark(bm)!.label).toBe('m');
    const cat = db.addCatalog({ name: 'G', url: 'https://x' });
    db.updateCatalog(cat, { name: 'G2' });
    expect(db.getCatalogByName('G2')!.url).toBe('https://x');
    db.close();
  });

  it('throws DatabaseError on unopenable path', () => {
    const dbDir = path.join(dir, 'not-a-db');
    fs.mkdirSync(dbDir);
    expect(() => new LibraryDb(dbDir)).toThrow();
  });
});
