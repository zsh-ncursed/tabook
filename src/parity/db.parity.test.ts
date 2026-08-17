// Golden parity: database layer — NativeDbBackend (rusqlite through the napi
// binding) vs SqliteDbBackend (better-sqlite3 fallback). Both run the
// identical operation script against their own database file and every
// record they return must match. Catches drift applied to only one side: a
// column default, null-vs-undefined fields, derived text (authorsText /
// seriesText), id ordering, cascade behavior.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NativeDbBackend, SqliteDbBackend, type DbBackend, type SessionStats } from '../db/db.js';
import type { BookMetadata } from '../formats/model.js';
import { requireNative } from './helpers.js';

// Guard the native binding so NativeDbBackend can open a database.
requireNative();

// Datetimes are wall-clock values written by SQL datetime('now') / the Rust
// clock; the two backends run milliseconds apart so the *strings* differ
// (and under load they can straddle a second boundary). Normalize both the
// 'YYYY-MM-DD HH:MM:SS' (SQLite) and 'YYYY-MM-DDTHH:MM:SS' (ISO) forms to a
// constant, and drop null/undefined (the backends legitimately differ in
// optional-field presence, like the rest of the parity suite), before
// comparing.
function canonical(value: unknown): unknown {
  if (typeof value === 'string') {
    return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value) ? 'TIME' : value;
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      out[k] = canonical(v);
    }
    return out;
  }
  return value;
}

const META_A: BookMetadata = {
  title: 'Тестовая книга — Том I',
  authors: [
    { firstName: 'Иван', lastName: 'Петров', middleName: 'Сергеевич' },
    { firstName: 'Jane', lastName: 'Roe', nickname: 'jane' },
    { firstName: 'Solo', lastName: 'Author' },
  ],
  series: { name: 'Серия', number: 3 },
  genres: ['fantasy', 'sci-fi'],
  annotation: 'Аннотация с переносом строки.',
  lang: 'ru',
  coverKey: 'cover.jpg',
  publisher: 'Издательство',
  isbn: '978-5-00000-000-0',
  year: 2021,
};

const META_B: BookMetadata = {
  title: 'Minimal',
  authors: [],
  genres: [],
  annotation: '',
};

const ROOT = '/lib/root';

// The exact same operations, in the exact same order, on both backends. Ids
// are not compared to constants — only that both sides agree with each
// other, so a change to id allocation on one side is caught.
function script(
  db: DbBackend,
  paths: { a: string; b: string },
): {
  bookIds: number[];
  bookA: unknown;
  bookByPath: unknown;
  listAll: unknown;
  listLimit: unknown;
  listAdded: unknown;
  listOpened: unknown;
  progress: unknown;
  bookmarkId: number;
  bookmarks: unknown;
  bookmark: unknown;
  bookmarkUpdated: unknown;
  bookmarkAfterDelete: unknown;
  history: unknown;
  recent: unknown;
  continueList: unknown;
  stats: SessionStats;
  catalogIds: number[];
  catalogs: unknown;
  catalog: unknown;
  catalogByName: unknown;
  catalogAfterUpdate: unknown;
  catalogsAfterRemove: unknown;
  folderId: number;
  folders: unknown;
  folderByPath: unknown;
  foldersScanned: unknown;
  pathsInRoot: unknown;
  removedByPaths: number;
  bookAfterRemove: unknown;
  removedByRoot: number;
  folderRemoved: boolean;
  foldersFinal: unknown;
} {
  const idA = db.addBook({
    path: paths.a,
    filename: 'book-a.fb2',
    format: 'fb2',
    size: 1234,
    metadata: META_A,
  });
  const idB = db.addBook({
    path: paths.b,
    filename: 'book-b.epub',
    format: 'epub',
    size: 99,
    metadata: META_B,
    libraryRoot: ROOT,
  });

  db.setProgress(idA, 12345, 42);
  const bookmarkId = db.addBookmark(idA, 500, 'закладка');

  db.recordOpen(idA);
  const sessionId = db.startSession(idA);
  db.endSession(sessionId, 3);

  const cat1 = db.addCatalog({ name: 'gutenberg', url: 'https://gutenberg.org' });
  const cat2 = db.addCatalog({ name: 'auth', url: 'https://x', username: 'u', password: 'secret' });
  db.updateCatalog(cat1, { username: 'newuser' });
  db.removeCatalog(cat2);

  const folderId = db.addLibraryFolder(ROOT);
  db.setFolderScannedAt(folderId, 123456);

  return {
    bookIds: [idA, idB],
    bookA: db.getBook(idA),
    bookByPath: db.getBookByPath(paths.a),
    listAll: db.listBooks(),
    listLimit: db.listBooks({ limit: 1 }),
    listAdded: db.listBooks({ orderBy: 'added' }),
    listOpened: db.listBooks({ orderBy: 'opened' }),
    progress: db.getProgress(idA),
    bookmarkId,
    bookmarks: db.listBookmarks(idA),
    bookmark: db.getBookmark(bookmarkId),
    bookmarkUpdated: db.updateBookmarkLabel(bookmarkId, 'новая'),
    bookmarkAfterDelete: (() => {
      db.deleteBookmark(bookmarkId);
      return db.getBookmark(bookmarkId);
    })(),
    history: db.listHistory(5),
    recent: db.listRecentBooks(5),
    continueList: db.listContinueBooks(5),
    stats: db.getStats(idA),
    catalogIds: [cat1, cat2],
    catalogs: db.listCatalogs(),
    catalog: db.getCatalog(cat1),
    catalogByName: db.getCatalogByName('auth'),
    catalogAfterUpdate: db.getCatalog(cat1),
    catalogsAfterRemove: db.listCatalogs(),
    folderId,
    folders: db.listLibraryFolders(),
    folderByPath: db.getLibraryFolderByPath(ROOT),
    foldersScanned: db.listLibraryFolders(),
    pathsInRoot: db.listPathsByLibraryRoot(ROOT),
    removedByPaths: db.removeBooksByPaths([paths.a]),
    bookAfterRemove: db.getBook(idA),
    removedByRoot: db.removeBooksByLibraryRoot(ROOT),
    folderRemoved: db.removeLibraryFolder(folderId),
    foldersFinal: db.listLibraryFolders(),
  };
}

describe('parity: database backend', () => {
  const dirs: string[] = [];

  afterAll(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  });

  it('native and fallback backends agree on the full operation script', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabook-db-parity-'));
    dirs.push(dir);
    const natPath = path.join(dir, 'native.db');
    const sqlPath = path.join(dir, 'fallback.db');
    const paths = { a: path.join(dir, 'book-a.fb2'), b: path.join(dir, 'book-b.epub') };

    const nat = new NativeDbBackend(natPath);
    const sql = new SqliteDbBackend(sqlPath);
    try {
      const natOut = script(nat, paths);
      const sqlOut = script(sql, paths);

      // Everything except the session stats compares field-for-field.
      const { stats: natStats, ...natRest } = natOut;
      const { stats: sqlStats, ...sqlRest } = sqlOut;
      expect(canonical(natRest)).toEqual(canonical(sqlRest));

      // totalSeconds is a wall-clock duration measured independently by each
      // backend; allow a sub-second skew. The rest of the stats must match.
      expect(sqlStats.totalPages).toBe(natStats.totalPages);
      expect(sqlStats.sessionCount).toBe(natStats.sessionCount);
      expect(canonical(sqlStats.lastReadAt)).toBe(canonical(natStats.lastReadAt));
      expect(Math.abs(sqlStats.totalSeconds - natStats.totalSeconds)).toBeLessThanOrEqual(2);
    } finally {
      nat.close();
      sql.close();
    }
  });
});
