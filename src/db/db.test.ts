import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LibraryDb } from './db.js';
import { DatabaseError } from '../utils/errors.js';
import type { BookMetadata } from '../formats/model.js';

const metadata: BookMetadata = {
  title: 'Book One',
  authors: [{ firstName: 'Ann', lastName: 'Lee' }],
  series: { name: 'Trilogy', number: 1 },
  genres: ['sf'],
  annotation: 'Some words.',
  lang: 'en',
};

let dir: string;
let db: LibraryDb;

function makeDb(): LibraryDb {
  return new LibraryDb(path.join(dir, `lib-${Math.random().toString(36).slice(2)}.sqlite`));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabook-test-'));
  db = makeDb();
});

afterEach(() => {
  db.close();
});

describe('LibraryDb', () => {
  it('adds and retrieves a book', () => {
    const id = db.addBook({
      path: '/tmp/book-one.fb2',
      filename: 'book-one.fb2',
      format: 'fb2',
      size: 1234,
      metadata,
    });
    expect(id).toBeGreaterThan(0);
    const book = db.getBook(id)!;
    expect(book.title).toBe('Book One');
    expect(book.authorsText).toBe('Lee Ann');
    expect(book.seriesText).toBe('Trilogy #1');
    expect(book.format).toBe('fb2');
  });

  it('persists nickname-only authors', () => {
    const id = db.addBook({
      path: '/tmp/nick.fb2',
      filename: 'nick.fb2',
      format: 'fb2',
      size: 1,
      metadata: {
        title: 'N',
        authors: [{ firstName: '', lastName: '', nickname: 'Zed' }],
        genres: [],
        annotation: '',
      },
    });
    const book = db.getBook(id)!;
    expect(book.authors).toEqual([
      { firstName: '', lastName: '', middleName: '', nickname: 'Zed' },
    ]);
    expect(book.authorsText).toBe('Zed');
  });

  it('upserts by path instead of duplicating', () => {
    const id1 = db.addBook({
      path: '/tmp/b.fb2',
      filename: 'b.fb2',
      format: 'fb2',
      size: 1,
      metadata: { ...metadata, title: 'First' },
    });
    const id2 = db.addBook({
      path: '/tmp/b.fb2',
      filename: 'b.fb2',
      format: 'fb2',
      size: 2,
      metadata: { ...metadata, title: 'Second' },
    });
    expect(id2).toBe(id1);
    expect(db.listBooks()).toHaveLength(1);
    expect(db.getBook(id1)!.title).toBe('Second');
  });

  it('lists books and removes them', () => {
    const id = db.addBook({
      path: '/tmp/x.fb2',
      filename: 'x.fb2',
      format: 'fb2',
      size: 1,
      metadata,
    });
    expect(db.listBooks()).toHaveLength(1);
    expect(db.removeBook(id)).toBe(true);
    expect(db.removeBook(id)).toBe(false);
    expect(db.getBook(id)).toBeUndefined();
  });

  it('persists and updates reading progress', () => {
    const id = db.addBook({
      path: '/tmp/p.fb2',
      filename: 'p.fb2',
      format: 'fb2',
      size: 1,
      metadata,
    });
    expect(db.getProgress(id)).toBeUndefined();
    db.setProgress(id, 500, 12.5);
    const prog = db.getProgress(id)!;
    expect(prog.position).toBe(500);
    expect(prog.percent).toBeCloseTo(12.5);
    db.setProgress(id, 900, 40);
    expect(db.getProgress(id)!.position).toBe(900);
    expect(db.getBook(id)!.progressPosition).toBe(900);
  });

  it('adds and lists bookmarks in position order', () => {
    const id = db.addBook({
      path: '/tmp/bm.fb2',
      filename: 'bm.fb2',
      format: 'fb2',
      size: 1,
      metadata,
    });
    const second = db.addBookmark(id, 200, 'second');
    const first = db.addBookmark(id, 100, 'first');
    const marks = db.listBookmarks(id);
    expect(marks.map((m) => m.label)).toEqual(['first', 'second']);
    expect(db.getBookmark(first)!.label).toBe('first');
    expect(db.deleteBookmark(second)).toBe(true);
    expect(db.listBookmarks(id)).toHaveLength(1);
  });

  it('records open history and lastOpenedAt', () => {
    const id = db.addBook({
      path: '/tmp/h.fb2',
      filename: 'h.fb2',
      format: 'fb2',
      size: 1,
      metadata,
    });
    db.recordOpen(id);
    const history = db.listHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.bookId).toBe(id);
    expect(db.getBook(id)!.lastOpenedAt).toBeTruthy();
  });

  it('tracks reading sessions and stats', () => {
    const id = db.addBook({
      path: '/tmp/s.fb2',
      filename: 's.fb2',
      format: 'fb2',
      size: 1,
      metadata,
    });
    const session = db.startSession(id);
    db.endSession(session, 15);
    const stats = db.getStats(id);
    expect(stats.sessionCount).toBe(1);
    expect(stats.totalPages).toBe(15);
    expect(stats.lastReadAt).toBeTruthy();
  });

  it('throws DatabaseError when the database cannot be opened', () => {
    // better-sqlite3 cannot open a directory as a database (SQLITE_CANTOPEN).
    const dbDir = path.join(dir, 'not-a-db');
    fs.mkdirSync(dbDir);
    expect(() => new LibraryDb(dbDir)).toThrow(DatabaseError);
  });

  it('persists across reopens', () => {
    const filePath = path.join(dir, 'persist.sqlite');
    const d1 = new LibraryDb(filePath);
    const id = d1.addBook({
      path: '/tmp/final.fb2',
      filename: 'final.fb2',
      format: 'epub',
      size: 99,
      metadata,
    });
    d1.setProgress(id, 700, 33);
    d1.close();

    const d2 = new LibraryDb(filePath);
    const book = d2.getBook(id)!;
    expect(book.progressPercent).toBeCloseTo(33);
    expect(book.progressPosition).toBe(700);
    d2.close();
  });
});

describe('LibraryDb OPDS catalogs', () => {
  it('starts with no catalogs', () => {
    expect(db.listCatalogs()).toEqual([]);
  });

  it('adds and lists catalogs sorted by name', () => {
    db.addCatalog({ name: 'Gutenberg', url: 'https://m.gutenberg.org/ebooks.opds/' });
    db.addCatalog({ name: 'Anarchist', url: 'https://theanarchistlibrary.org/opds' });
    const catalogs = db.listCatalogs();
    expect(catalogs).toHaveLength(2);
    expect(catalogs[0]!.name).toBe('Anarchist');
    expect(catalogs[1]!.name).toBe('Gutenberg');
  });

  it('adds catalog with credentials', () => {
    const id = db.addCatalog({
      name: 'Standard Ebooks',
      url: 'https://standardebooks.org/feeds/opds',
      username: 'user@example.com',
      password: 'secret',
    });
    const cat = db.getCatalog(id)!;
    expect(cat.username).toBe('user@example.com');
    expect(cat.password).toBe('secret');
  });

  it('adds catalog without credentials', () => {
    const id = db.addCatalog({ name: 'Public', url: 'https://x/opds' });
    const cat = db.getCatalog(id)!;
    expect(cat.username).toBeNull();
    expect(cat.password).toBeNull();
  });

  it('getCatalog returns undefined for missing id', () => {
    expect(db.getCatalog(999)).toBeUndefined();
  });

  it('getCatalogByName finds by name', () => {
    db.addCatalog({ name: 'Gallica', url: 'https://gallica.bnf.fr/opds' });
    const cat = db.getCatalogByName('Gallica')!;
    expect(cat.url).toBe('https://gallica.bnf.fr/opds');
  });

  it('getCatalogByName returns undefined for missing name', () => {
    expect(db.getCatalogByName('Nonexistent')).toBeUndefined();
  });

  it('removes a catalog', () => {
    const id = db.addCatalog({ name: 'Temp', url: 'https://x/opds' });
    db.removeCatalog(id);
    expect(db.getCatalog(id)).toBeUndefined();
    expect(db.listCatalogs()).toEqual([]);
  });

  it('removeCatalog is a no-op for missing id', () => {
    db.removeCatalog(999);
    expect(db.listCatalogs()).toEqual([]);
  });

  it('updates catalog name', () => {
    const id = db.addCatalog({ name: 'Old', url: 'https://x/opds' });
    db.updateCatalog(id, { name: 'New' });
    expect(db.getCatalog(id)!.name).toBe('New');
  });

  it('updates catalog url', () => {
    const id = db.addCatalog({ name: 'X', url: 'https://old/opds' });
    db.updateCatalog(id, { url: 'https://new/opds' });
    expect(db.getCatalog(id)!.url).toBe('https://new/opds');
  });

  it('updates catalog credentials', () => {
    const id = db.addCatalog({ name: 'X', url: 'https://x/opds' });
    db.updateCatalog(id, { username: 'user', password: 'pass' });
    const cat = db.getCatalog(id)!;
    expect(cat.username).toBe('user');
    expect(cat.password).toBe('pass');
  });

  it('updateCatalog with no fields is a no-op', () => {
    const id = db.addCatalog({ name: 'X', url: 'https://x/opds' });
    db.updateCatalog(id, {});
    expect(db.getCatalog(id)!.name).toBe('X');
  });

  it('persists catalogs across db reopen', () => {
    const filePath = path.join(dir, 'catalog-persist.sqlite');
    const d1 = new LibraryDb(filePath);
    d1.addCatalog({ name: 'Gutenberg', url: 'https://m.gutenberg.org/ebooks.opds/' });
    d1.close();

    const d2 = new LibraryDb(filePath);
    const catalogs = d2.listCatalogs();
    expect(catalogs).toHaveLength(1);
    expect(catalogs[0]!.name).toBe('Gutenberg');
    d2.close();
  });

  it('migrates from v1 to v2 adding opds_catalogs table', () => {
    const filePath = path.join(dir, 'migrate.sqlite');
    const d1 = new LibraryDb(filePath);
    d1.close();
    // Manually set user_version back to 1 to simulate a v1 DB
    const raw = new (require('better-sqlite3'))(filePath) as import('better-sqlite3').Database;
    raw.pragma('user_version = 1');
    raw.close();

    const d2 = new LibraryDb(filePath);
    expect(d2.listCatalogs()).toEqual([]);
    d2.addCatalog({ name: 'Test', url: 'https://x/opds' });
    expect(d2.listCatalogs()).toHaveLength(1);
    d2.close();
  });
});
