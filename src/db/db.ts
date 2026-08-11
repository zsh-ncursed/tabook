import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseError, messageOf } from '../utils/errors.js';
import { ensureDir } from '../utils/paths.js';
import type { BookMetadata } from '../formats/model.js';
import { joinAuthors, formatSeries } from '../formats/model.js';

export interface BookRecord extends BookMetadata {
  id: number;
  path: string;
  filename: string;
  format: 'fb2' | 'epub';
  size: number;
  addedAt: string;
  lastOpenedAt: string | null;
  authorsText: string;
  seriesText: string | null;
  progressPercent: number | null;
  progressPosition: number | null;
}

export interface BookmarkRecord {
  id: number;
  bookId: number;
  position: number;
  label: string;
  createdAt: string;
}

export interface ProgressRecord {
  bookId: number;
  position: number;
  percent: number;
  updatedAt: string;
}

export interface HistoryRecord {
  bookId: number;
  title: string;
  openedAt: string;
}

export interface SessionStats {
  totalSeconds: number;
  totalPages: number;
  sessionCount: number;
  lastReadAt: string | null;
}

export interface CatalogRecord {
  id: number;
  name: string;
  url: string;
  username: string | null;
  password: string | null;
}

export interface LibraryFolderRecord {
  id: number;
  path: string;
  addedAt: string;
  // Epoch milliseconds of the last completed scan, used to skip rescans of
  // folders whose files haven't changed (mtime comparison). null = never
  // scanned (or scanned before this column existed) → must scan.
  lastScannedAt: number | null;
}

export type SortField = 'title' | 'author' | 'added' | 'progress';

interface BookRow {
  id: number;
  path: string;
  filename: string;
  format: string;
  size: number;
  title: string;
  authors: string;
  series_name: string | null;
  series_number: number | null;
  genres: string;
  annotation: string;
  lang: string | null;
  cover_key: string | null;
  publisher: string | null;
  isbn: string | null;
  year: number | null;
  added_at: string;
  last_opened_at: string | null;
  progress_percent: number | null;
  progress_position: number | null;
}

interface CatalogRow {
  id: number;
  name: string;
  url: string;
  username: string | null;
  password: string | null;
}

function rowToCatalog(row: CatalogRow): CatalogRecord {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    username: row.username,
    password: row.password,
  };
}

function rowToBook(row: BookRow): BookRecord {
  const genreList = row.genres === '' ? [] : row.genres.split('\n');
  const authors: BookMetadata['authors'] = [];
  for (const line of row.authors.split('\n')) {
    if (line === '') continue;
    const [firstName, lastName, middleName, nickname] = line.split('\t');
    authors.push({
      firstName: firstName ?? '',
      lastName: lastName ?? '',
      middleName,
      nickname: nickname !== '' ? nickname : undefined,
    });
  }
  const metadata: BookMetadata = {
    title: row.title,
    authors,
    genres: genreList,
    annotation: row.annotation,
    lang: row.lang ?? undefined,
    coverKey: row.cover_key ?? undefined,
    publisher: row.publisher ?? undefined,
    isbn: row.isbn ?? undefined,
    year: row.year ?? undefined,
  };
  if (row.series_name) {
    metadata.series = { name: row.series_name, number: row.series_number ?? undefined };
  }
  return {
    ...metadata,
    id: row.id,
    path: row.path,
    filename: row.filename,
    format: row.format as 'fb2' | 'epub',
    size: row.size,
    addedAt: row.added_at,
    lastOpenedAt: row.last_opened_at,
    authorsText: joinAuthors(authors),
    seriesText: formatSeries(metadata.series) ?? null,
    progressPercent: row.progress_percent,
    progressPosition: row.progress_position,
  };
}

const SCHEMA_VERSION = 4;

export class LibraryDb {
  private readonly db: Database.Database;
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    try {
      ensureDir(path.dirname(filePath));
      this.db = new Database(filePath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.migrate();
    } catch (err) {
      // Defensive: ensureDir/better-sqlite3 currently throw Error, but a non-Error
      // throw (e.g. a future dependency throwing a string or null) would render
      // messageOf(err as Error) produce "undefined". Keep the unknown guard so
      // the error message stays meaningful without trusting the throw site.
      throw new DatabaseError(`Cannot open database at ${filePath}: ${messageOf(err)}`, {
        cause: err,
      });
    }
  }

  private migrate(): void {
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version >= SCHEMA_VERSION) return;
    // Forward-only migrations. v0 (fresh DB) gets the full schema via the
    // bootstrap; future versions append ALTER TABLE statements here gated on
    // the previous version so existing tables gain columns without the IF NOT
    // EXISTS no-op that would silently skip new columns on existing tables.
    if (version < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS books (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          path TEXT NOT NULL UNIQUE,
          filename TEXT NOT NULL,
          format TEXT NOT NULL,
          size INTEGER NOT NULL DEFAULT 0,
          title TEXT NOT NULL,
          authors TEXT NOT NULL DEFAULT '',
          series_name TEXT,
          series_number REAL,
          genres TEXT NOT NULL DEFAULT '',
          annotation TEXT NOT NULL DEFAULT '',
          lang TEXT,
          cover_key TEXT,
          publisher TEXT,
          isbn TEXT,
          year INTEGER,
          added_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_opened_at TEXT
        );
        CREATE TABLE IF NOT EXISTS reading_progress (
          book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
          position INTEGER NOT NULL DEFAULT 0,
          percent REAL NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS bookmarks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          label TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id);
        CREATE TABLE IF NOT EXISTS reading_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          pages_read INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_book ON reading_sessions(book_id);
        CREATE TABLE IF NOT EXISTS history (
          book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
          opened_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    }
    // Example for the next migration:
    //   if (version < 2) { this.db.exec('ALTER TABLE books ADD COLUMN x ...'); }
    if (version < 2) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS opds_catalogs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          username TEXT,
          password TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    }
    if (version < 3) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS library_folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          path TEXT NOT NULL UNIQUE,
          added_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      // ALTER TABLE has no IF NOT EXISTS; guard against a partially-applied
      // migration (crash between the CREATE above and the version bump).
      const cols = this.db.prepare('PRAGMA table_info(books)').all() as { name: string }[];
      if (!cols.some((c) => c.name === 'library_root')) {
        this.db.exec('ALTER TABLE books ADD COLUMN library_root TEXT');
      }
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_books_library_root ON books(library_root)');
    }
    if (version < 4) {
      const cols = this.db.prepare('PRAGMA table_info(library_folders)').all() as {
        name: string;
      }[];
      if (!cols.some((c) => c.name === 'last_scanned_at')) {
        this.db.exec('ALTER TABLE library_folders ADD COLUMN last_scanned_at INTEGER');
      }
    }
    this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  close(): void {
    this.db.close();
  }

  // ---- Books ----

  addBook(record: {
    path: string;
    filename: string;
    format: 'fb2' | 'epub';
    size: number;
    metadata: BookMetadata;
    // Which attached library folder this book was scanned from (if any).
    // Detaching that folder removes its books, so a manually saved book
    // (no root) keeps the existing root instead of nulling it on re-save.
    libraryRoot?: string;
  }): number {
    const metadata = record.metadata;
    const authorsLine = metadata.authors
      .map(
        (a) =>
          `${a.firstName ?? ''}\t${a.lastName ?? ''}\t${a.middleName ?? ''}\t${a.nickname ?? ''}`,
      )
      .join('\n');
    const genresLine = metadata.genres.join('\n');

    // Atomic upsert: INSERT ... ON CONFLICT(path) DO UPDATE — avoids the
    // race condition of the previous getBookByPath → INSERT/UPDATE pattern.
    this.db
      .prepare(
        `INSERT INTO books (path, filename, format, size, title, authors, series_name, series_number,
         genres, annotation, lang, cover_key, publisher, isbn, year, library_root)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           filename=excluded.filename,
           format=excluded.format,
           size=excluded.size,
           title=excluded.title,
           authors=excluded.authors,
           series_name=excluded.series_name,
           series_number=excluded.series_number,
           genres=excluded.genres,
           annotation=excluded.annotation,
           lang=excluded.lang,
           cover_key=excluded.cover_key,
           publisher=excluded.publisher,
           isbn=excluded.isbn,
           year=excluded.year,
           library_root=COALESCE(excluded.library_root, books.library_root)`,
      )
      .run(
        record.path,
        record.filename,
        record.format,
        record.size,
        metadata.title,
        authorsLine,
        metadata.series?.name ?? null,
        metadata.series?.number ?? null,
        genresLine,
        metadata.annotation,
        metadata.lang ?? null,
        metadata.coverKey ?? null,
        metadata.publisher ?? null,
        metadata.isbn ?? null,
        metadata.year ?? null,
        record.libraryRoot ?? null,
      );

    // After the upsert, look up the row by path to get the stable id.
    const row = this.db.prepare('SELECT id FROM books WHERE path = ?').get(record.path) as
      { id: number } | undefined;
    return row!.id;
  }

  getBook(id: number): BookRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT b.*, p.position AS progress_position, p.percent AS progress_percent
         FROM books b LEFT JOIN reading_progress p ON p.book_id = b.id WHERE b.id = ?`,
      )
      .get(id) as BookRow | undefined;
    return row ? rowToBook(row) : undefined;
  }

  getBookByPath(filePath: string): BookRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT b.*, p.position AS progress_position, p.percent AS progress_percent
         FROM books b LEFT JOIN reading_progress p ON p.book_id = b.id WHERE b.path = ?`,
      )
      .get(filePath) as BookRow | undefined;
    return row ? rowToBook(row) : undefined;
  }

  listBooks(opts?: {
    limit?: number;
    offset?: number;
    orderBy?: 'title' | 'added' | 'opened';
  }): BookRecord[] {
    const limit = opts?.limit;
    const offset = opts?.offset ?? 0;
    const orderClause =
      opts?.orderBy === 'opened'
        ? 'ORDER BY b.last_opened_at DESC NULLS LAST, b.title'
        : opts?.orderBy === 'added'
          ? 'ORDER BY b.added_at DESC, b.title'
          : 'ORDER BY b.title';
    const sql = `SELECT b.*, p.position AS progress_position, p.percent AS progress_percent
         FROM books b LEFT JOIN reading_progress p ON p.book_id = b.id ${orderClause}
         ${limit !== undefined ? 'LIMIT ? OFFSET ?' : ''}`;
    const params = limit !== undefined ? [limit, offset] : [];
    const rows = this.db.prepare(sql).all(...params) as BookRow[];
    return rows.map(rowToBook);
  }

  removeBook(id: number): boolean {
    const info = this.db.prepare('DELETE FROM books WHERE id = ?').run(id);
    return info.changes > 0;
  }

  // ---- Reading progress ----

  setProgress(bookId: number, position: number, percent: number): void {
    this.db
      .prepare(
        `INSERT INTO reading_progress (book_id, position, percent, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(book_id) DO UPDATE SET position=excluded.position,
           percent=excluded.percent, updated_at=excluded.updated_at`,
      )
      .run(bookId, position, percent);
  }

  getProgress(bookId: number): ProgressRecord | undefined {
    const row = this.db.prepare('SELECT * FROM reading_progress WHERE book_id = ?').get(bookId) as
      { book_id: number; position: number; percent: number; updated_at: string } | undefined;
    return row
      ? {
          bookId: row.book_id,
          position: row.position,
          percent: row.percent,
          updatedAt: row.updated_at,
        }
      : undefined;
  }

  // ---- Bookmarks ----

  addBookmark(bookId: number, position: number, label: string): number {
    const info = this.db
      .prepare(
        `INSERT INTO bookmarks (book_id, position, label, created_at) VALUES (?, ?, ?, datetime('now'))`,
      )
      .run(bookId, position, label);
    return Number(info.lastInsertRowid);
  }

  listBookmarks(bookId: number): BookmarkRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM bookmarks WHERE book_id = ? ORDER BY position ASC')
      .all(bookId) as {
      id: number;
      book_id: number;
      position: number;
      label: string;
      created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      bookId: r.book_id,
      position: r.position,
      label: r.label,
      createdAt: r.created_at,
    }));
  }

  getBookmark(id: number): BookmarkRecord | undefined {
    const row = this.db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id) as
      | { id: number; book_id: number; position: number; label: string; created_at: string }
      | undefined;
    return row
      ? {
          id: row.id,
          bookId: row.book_id,
          position: row.position,
          label: row.label,
          createdAt: row.created_at,
        }
      : undefined;
  }

  deleteBookmark(id: number): boolean {
    const info = this.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
    return info.changes > 0;
  }

  updateBookmarkLabel(id: number, label: string): boolean {
    const info = this.db.prepare('UPDATE bookmarks SET label = ? WHERE id = ?').run(label, id);
    return info.changes > 0;
  }

  // ---- History ----

  recordOpen(bookId: number): void {
    this.db
      .prepare(
        `INSERT INTO history (book_id, opened_at) VALUES (?, datetime('now'))
         ON CONFLICT(book_id) DO UPDATE SET opened_at=excluded.opened_at`,
      )
      .run(bookId);
    this.db.prepare("UPDATE books SET last_opened_at = datetime('now') WHERE id = ?").run(bookId);
  }

  listHistory(limit = 20): HistoryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT h.book_id AS bookId, h.opened_at AS openedAt, b.title AS title
         FROM history h JOIN books b ON b.id = h.book_id ORDER BY h.opened_at DESC LIMIT ?`,
      )
      .all(limit) as { bookId: number; openedAt: string; title: string }[];
    return rows.map((r) => ({ bookId: r.bookId, openedAt: r.openedAt, title: r.title }));
  }

  listRecentBooks(limit = 20): BookRecord[] {
    const rows = this.db
      .prepare(
        `SELECT b.*, p.position AS progress_position, p.percent AS progress_percent
         FROM books b LEFT JOIN reading_progress p ON p.book_id = b.id
         WHERE b.last_opened_at IS NOT NULL
         ORDER BY b.last_opened_at DESC LIMIT ?`,
      )
      .all(limit) as BookRow[];
    return rows.map(rowToBook);
  }

  // ---- Reading sessions / stats ----

  startSession(bookId: number): number {
    const info = this.db
      .prepare("INSERT INTO reading_sessions (book_id, started_at) VALUES (?, datetime('now'))")
      .run(bookId);
    return Number(info.lastInsertRowid);
  }

  endSession(sessionId: number, pagesRead: number): void {
    this.db
      .prepare(
        "UPDATE reading_sessions SET ended_at = datetime('now'), pages_read = ? WHERE id = ?",
      )
      .run(pagesRead, sessionId);
  }

  getStats(bookId: number): SessionStats {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS sessionCount,
           COALESCE(SUM(CASE WHEN ended_at IS NOT NULL THEN
             CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER) ELSE 0 END), 0)
             AS totalSeconds,
           COALESCE(SUM(pages_read), 0) AS totalPages,
           MAX(COALESCE(ended_at, started_at)) AS lastReadAt
         FROM reading_sessions WHERE book_id = ?`,
      )
      .get(bookId) as {
      sessionCount: number;
      totalSeconds: number;
      totalPages: number;
      lastReadAt: string | null;
    };
    return {
      sessionCount: row.sessionCount,
      totalSeconds: row.totalSeconds,
      totalPages: row.totalPages,
      lastReadAt: row.lastReadAt,
    };
  }

  fileExists(): boolean {
    return fs.existsSync(this.filePath);
  }

  // ---- OPDS Catalogs ----

  addCatalog(catalog: { name: string; url: string; username?: string; password?: string }): number {
    const info = this.db
      .prepare('INSERT INTO opds_catalogs (name, url, username, password) VALUES (?, ?, ?, ?)')
      .run(catalog.name, catalog.url, catalog.username ?? null, catalog.password ?? null);
    return Number(info.lastInsertRowid);
  }

  listCatalogs(): CatalogRecord[] {
    const rows = this.db
      .prepare('SELECT id, name, url, username, password FROM opds_catalogs ORDER BY name')
      .all() as CatalogRow[];
    return rows.map(rowToCatalog);
  }

  getCatalog(id: number): CatalogRecord | undefined {
    const row = this.db
      .prepare('SELECT id, name, url, username, password FROM opds_catalogs WHERE id = ?')
      .get(id) as CatalogRow | undefined;
    return row ? rowToCatalog(row) : undefined;
  }

  getCatalogByName(name: string): CatalogRecord | undefined {
    const row = this.db
      .prepare('SELECT id, name, url, username, password FROM opds_catalogs WHERE name = ?')
      .get(name) as CatalogRow | undefined;
    return row ? rowToCatalog(row) : undefined;
  }

  updateCatalog(
    id: number,
    fields: { name?: string; url?: string; username?: string; password?: string },
  ): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (fields.name !== undefined) {
      sets.push('name = ?');
      values.push(fields.name);
    }
    if (fields.url !== undefined) {
      sets.push('url = ?');
      values.push(fields.url);
    }
    if (fields.username !== undefined) {
      sets.push('username = ?');
      values.push(fields.username);
    }
    if (fields.password !== undefined) {
      sets.push('password = ?');
      values.push(fields.password);
    }
    if (sets.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE opds_catalogs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  removeCatalog(id: number): void {
    this.db.prepare('DELETE FROM opds_catalogs WHERE id = ?').run(id);
  }

  // ---- Library folders ----

  addLibraryFolder(folderPath: string): number {
    // Idempotent: re-adding the same folder is a no-op that returns its id.
    this.db
      .prepare('INSERT INTO library_folders (path) VALUES (?) ON CONFLICT(path) DO NOTHING')
      .run(folderPath);
    const row = this.db.prepare('SELECT id FROM library_folders WHERE path = ?').get(folderPath) as
      { id: number } | undefined;
    return row!.id;
  }

  listLibraryFolders(): LibraryFolderRecord[] {
    const rows = this.db
      .prepare('SELECT id, path, added_at, last_scanned_at FROM library_folders ORDER BY path')
      .all() as { id: number; path: string; added_at: string; last_scanned_at: number | null }[];
    return rows.map((r) => ({
      id: r.id,
      path: r.path,
      addedAt: r.added_at,
      lastScannedAt: r.last_scanned_at,
    }));
  }

  getLibraryFolderByPath(folderPath: string): LibraryFolderRecord | undefined {
    const row = this.db
      .prepare('SELECT id, path, added_at, last_scanned_at FROM library_folders WHERE path = ?')
      .get(folderPath) as
      { id: number; path: string; added_at: string; last_scanned_at: number | null } | undefined;
    return row
      ? {
          id: row.id,
          path: row.path,
          addedAt: row.added_at,
          lastScannedAt: row.last_scanned_at,
        }
      : undefined;
  }

  // Record the completion time of a scan (epoch ms) so the mtime-based dirty
  // check can skip rescans of unchanged folders.
  setFolderScannedAt(id: number, scannedAtMs: number): void {
    this.db
      .prepare('UPDATE library_folders SET last_scanned_at = ? WHERE id = ?')
      .run(scannedAtMs, id);
  }

  removeLibraryFolder(id: number): boolean {
    const info = this.db.prepare('DELETE FROM library_folders WHERE id = ?').run(id);
    return info.changes > 0;
  }

  // Absolute paths of books that were scanned from the given folder root.
  listPathsByLibraryRoot(root: string): string[] {
    const rows = this.db.prepare('SELECT path FROM books WHERE library_root = ?').all(root) as {
      path: string;
    }[];
    return rows.map((r) => r.path);
  }

  // Delete books by path (used by the scanner to drop vanished files).
  // Progress/bookmarks/sessions/history cascade via FK ON DELETE CASCADE.
  removeBooksByPaths(paths: string[]): number {
    if (paths.length === 0) return 0;
    const del = this.db.prepare('DELETE FROM books WHERE path = ?');
    let removed = 0;
    const tx = this.db.transaction((list: string[]) => {
      for (const p of list) removed += del.run(p).changes;
    });
    tx(paths);
    return removed;
  }

  // Delete all books scanned from a folder root, e.g. when the folder is
  // detached from the library.
  removeBooksByLibraryRoot(root: string): number {
    const info = this.db.prepare('DELETE FROM books WHERE library_root = ?').run(root);
    return info.changes;
  }
}
